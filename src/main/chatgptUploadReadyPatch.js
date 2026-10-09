const path = require('path');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalSendPrompt = ChatGPTController.prototype.sendPrompt;

// Keep the upload state separate from prompt entry. The reference file is injected
// first, the prompt is pasted as soon as ChatGPT accepts the file locally, and only
// the final Send action waits for the attachment preview/upload to become ready.
const pendingAttachments = new WeakMap();

function isUsableChatGPTUrl(controller, value) {
  if (typeof controller.sessions.isValidChatGPTThreadUrl === 'function') {
    return controller.sessions.isValidChatGPTThreadUrl(value);
  }
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') return false;
    if (url.pathname === '/' || url.pathname === '') return true;
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9-]+)$/);
    return Boolean(match && match[1].length >= 20 && !/^local-chatgpt/i.test(match[1]));
  } catch {
    return false;
  }
}

async function safeGoHome(controller, page) {
  controller.sessions.clearLastThreadUrl?.('chatgpt');
  if (/^https:\/\/chatgpt\.com\/?(?:[?#].*)?$/i.test(page.url())) return;
  try {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (error) {
    // If navigation itself reports a timeout but the browser reached ChatGPT and
    // the composer is already usable, continue instead of failing the workflow.
    if (!page.url().startsWith('https://chatgpt.com')) throw error;
  }
}

ChatGPTController.prototype.openPreferredThread = async function openPreferredThreadSafe(page) {
  const currentUrl = page.url();
  if (isUsableChatGPTUrl(this, currentUrl) && /^https:\/\/chatgpt\.com\/c\//i.test(currentUrl)) {
    this.sessions.rememberThreadUrl('chatgpt', currentUrl);
    return;
  }

  const saved = this.sessions.getLastThreadUrl('chatgpt');
  if (!saved || !isUsableChatGPTUrl(this, saved) || !/^https:\/\/chatgpt\.com\/c\//i.test(saved)) {
    if (saved) this.sessions.clearLastThreadUrl?.('chatgpt');
    if (!page.url().startsWith('https://chatgpt.com')) await safeGoHome(this, page);
    return;
  }

  if (page.url() === saved) return;

  try {
    await page.goto(saved, { waitUntil: 'domcontentloaded', timeout: 12000 });
    if (!isUsableChatGPTUrl(this, page.url()) || /\/c\/local-chatgpt/i.test(page.url())) {
      throw new Error('Saved ChatGPT thread resolved to an invalid local URL.');
    }
  } catch {
    await safeGoHome(this, page);
  }
};

ChatGPTController.prototype.ensureReady = async function ensureReadyBeforePaste(page) {
  await page.bringToFront();

  if (!page.url().startsWith('https://chatgpt.com')) {
    await safeGoHome(this, page);
  }

  await this.assertNoHumanGate(page);
  const auth = await this.sessions.detectAuthState('chatgpt', page);
  if (auth.status === 'needs-login') {
    throw new Error('ChatGPT is not signed in. Open Connections → ChatGPT → Open Login Browser, finish login in Chrome, then Test Session.');
  }

  try {
    return await this.locateComposer(page);
  } catch (error) {
    if (error.code === 'HUMAN_VERIFICATION_REQUIRED') throw error;

    // A remembered conversation can disappear, be renamed internally, or fail to
    // hydrate. Fall back to the ChatGPT home composer rather than failing before
    // image/text paste.
    await safeGoHome(this, page);
    await this.assertNoHumanGate(page);
    return this.locateComposer(page);
  }
};

async function composerAttachmentState(page, referencePath, baselineSources = []) {
  const fileName = path.basename(referencePath || '');
  return page.evaluate(({ expectedFileName, baselineSources: baseline }) => {
    const composer = document.querySelector(
      '#prompt-textarea, [data-testid="composer-text-input"], textarea[placeholder*="Message" i], textarea, [contenteditable="true"][data-placeholder], [contenteditable="true"]'
    );

    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) !== 0;
    };

    const composerRect = composer?.getBoundingClientRect?.() || null;
    const nearComposer = (element, topPadding = 360, sidePadding = 180, bottomPadding = 120) => {
      if (!visible(element)) return false;
      if (!composerRect) return true;
      const rect = element.getBoundingClientRect();
      return rect.bottom >= composerRect.top - topPadding
        && rect.top <= composerRect.bottom + bottomPadding
        && rect.right >= composerRect.left - sidePadding
        && rect.left <= composerRect.right + sidePadding;
    };

    const previews = [...document.querySelectorAll('img')].filter((image) => {
      if (!nearComposer(image)) return false;
      const rect = image.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24;
    });

    const previewSources = previews
      .map((image) => image.currentSrc || image.src || '')
      .filter(Boolean);
    const baselineSet = new Set(baseline || []);
    const newPreview = previewSources.some((source) => !baselineSet.has(source));

    const removeControls = [...document.querySelectorAll(
      'button[aria-label*="remove" i], button[title*="remove" i], [data-testid*="remove" i]'
    )].filter((element) => nearComposer(element));

    const attachmentNodes = [...document.querySelectorAll(
      '[data-testid*="attachment" i], [data-testid*="upload" i], [data-testid*="file" i]'
    )].filter((element) => nearComposer(element));

    const busyNodes = [...document.querySelectorAll(
      '[role="progressbar"], [aria-busy="true"], [data-state="loading"], [data-testid*="uploading" i], [data-testid*="progress" i]'
    )].filter((element) => nearComposer(element));

    const sendButton = [...document.querySelectorAll(
      'button[data-testid="send-button"], button[data-testid*="send" i], button[aria-label*="send" i]'
    )].find((element) => nearComposer(element, 120, 220, 160));

    let nearbyText = '';
    if (composer) {
      let node = composer;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const text = String(node.innerText || '');
        if (text.length > nearbyText.length) nearbyText = text;
        if (text.length > 4000) break;
      }
    }

    const sendEnabled = Boolean(
      sendButton
      && visible(sendButton)
      && !sendButton.disabled
      && sendButton.getAttribute('aria-disabled') !== 'true'
    );
    const busy = busyNodes.length > 0 || /uploading|processing (?:image|file)|attaching/i.test(nearbyText);
    const failed = /upload failed|failed to upload|couldn['’]t upload|unsupported file|file too large/i.test(nearbyText);
    const named = Boolean(expectedFileName && nearbyText.toLowerCase().includes(expectedFileName.toLowerCase()));

    return {
      previewCount: previews.length,
      previewSources,
      newPreview,
      removeCount: removeControls.length,
      attachmentCount: attachmentNodes.length,
      sendEnabled,
      busy,
      failed,
      named
    };
  }, { expectedFileName: fileName, baselineSources }).catch(() => ({
    previewCount: 0,
    previewSources: [],
    newPreview: false,
    removeCount: 0,
    attachmentCount: 0,
    sendEnabled: false,
    busy: false,
    failed: false,
    named: false
  }));
}

function attachmentVisible(state, before) {
  return state.newPreview
    || state.previewCount > before.previewCount
    || state.removeCount > before.removeCount
    || state.attachmentCount > before.attachmentCount
    || state.named;
}

async function findUploadInput(page) {
  const preferred = page.locator('input[type="file"][accept*="image" i]').first();
  if (await preferred.count()) return preferred;
  const any = page.locator('input[type="file"]').first();
  if (await any.count()) return any;
  return null;
}

async function setFilesOnInput(input, referencePath) {
  await input.setInputFiles(referencePath, { timeout: 5000 });
  return true;
}

async function clickFirstFast(candidates, timeout = 450) {
  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: 'visible', timeout });
      await candidate.click({ timeout: 1500 });
      return candidate;
    } catch {}
  }
  return null;
}

async function injectReferenceFile(page, referencePath) {
  let input = await findUploadInput(page);
  if (input) {
    await setFilesOnInput(input, referencePath);
    return { method: 'existing-file-input' };
  }

  const addControl = await clickFirstFast([
    page.locator('button[data-testid="composer-plus-btn"]:visible').first(),
    page.locator('button[data-testid*="composer" i][aria-label*="add" i]:visible').first(),
    page.locator('button[aria-label*="add files" i]:visible').first(),
    page.locator('button[aria-label*="attach" i]:visible').first(),
    page.locator('button[aria-label*="upload" i]:visible').first(),
    page.getByRole('button', { name: /add files|attach|upload|photos|files|add/i }).first()
  ], 500);

  if (!addControl) throw new Error('Could not find ChatGPT’s add-file control.');

  const inputAfterPlus = page.locator('input[type="file"]').first();
  await inputAfterPlus.waitFor({ state: 'attached', timeout: 1200 }).catch(() => {});
  input = await findUploadInput(page);
  if (input) {
    await setFilesOnInput(input, referencePath);
    return { method: 'plus-menu-file-input' };
  }

  const menuCandidates = [
    page.getByRole('menuitem', { name: /upload|photo|file/i }).first(),
    page.getByRole('button', { name: /upload from computer|add photos|add files|photos.*files/i }).first(),
    page.getByText(/upload from computer|add photos(?:\s*&\s*| and )files/i).first()
  ];

  for (const candidate of menuCandidates) {
    try {
      await candidate.waitFor({ state: 'visible', timeout: 500 });
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 1800 }).catch(() => null);
      await candidate.click({ timeout: 1500 });
      const chooser = await chooserPromise;
      if (chooser) {
        await chooser.setFiles(referencePath);
        return { method: 'native-file-chooser' };
      }
      input = await findUploadInput(page);
      if (input) {
        await setFilesOnInput(input, referencePath);
        return { method: 'upload-menu-file-input' };
      }
    } catch {}
  }

  throw new Error('ChatGPT opened the attachment menu, but ZeroPOD could not access its image file input.');
}

async function waitForAttachmentAccepted(page, pending, timeoutMs = 1800) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await composerAttachmentState(page, pending.referencePath, pending.before.previewSources);
    if (state.failed) throw new Error('ChatGPT reported that the reference image upload failed.');
    if (attachmentVisible(state, pending.before) || state.busy) return state;
    await wait(100);
  }
  return null;
}

async function waitForAttachmentReady(page, pending, timeoutMs = 25000) {
  const started = Date.now();
  let stableReadySince = 0;
  let sawAttachment = false;

  while (Date.now() - started < timeoutMs) {
    const state = await composerAttachmentState(page, pending.referencePath, pending.before.previewSources);
    if (state.failed) throw new Error('ChatGPT reported that the reference image upload failed.');

    const visibleNow = attachmentVisible(state, pending.before);
    if (visibleNow) sawAttachment = true;

    if (visibleNow && !state.busy) {
      if (!stableReadySince) stableReadySince = Date.now();
      const stableFor = Date.now() - stableReadySince;
      if ((state.sendEnabled && stableFor >= 200) || stableFor >= 900) return state;
    } else {
      stableReadySince = 0;
    }

    await wait(120);
  }

  if (!sawAttachment) {
    throw new Error('ChatGPT accepted the reference file, but its attachment preview never appeared. The generation prompt is still in the composer and was not sent without the image.');
  }
  throw new Error('The reference image appeared in ChatGPT, but it did not finish uploading within 25 seconds. The generation prompt is still in the composer and was not sent early.');
}

ChatGPTController.prototype.attachReference = async function attachReferenceFast(page, referencePath) {
  await this.assertNoHumanGate(page);

  // Final pre-paste guard: do not touch file inputs until the current composer is
  // definitely visible and interactive on the page we intend to use.
  const composer = await this.locateComposer(page);
  await composer.waitFor({ state: 'visible', timeout: 5000 });

  const before = await composerAttachmentState(page, referencePath, []);
  const injectedAt = Date.now();
  const injection = await injectReferenceFile(page, referencePath);
  const pending = { referencePath, before, injection, injectedAt };
  pendingAttachments.set(page, pending);

  await waitForAttachmentAccepted(page, pending, 1800);
  return true;
};

ChatGPTController.prototype.sendPrompt = async function sendPromptAfterUpload(page, composer) {
  await this.assertNoHumanGate(page);
  const pending = pendingAttachments.get(page);

  try {
    if (pending) await waitForAttachmentReady(page, pending, 25000);

    const sendButton = page.locator([
      'button[data-testid="send-button"]:visible',
      'button[data-testid*="send" i]:visible',
      'button[aria-label*="send" i]:visible'
    ].join(',')).first();

    if (await sendButton.count()) {
      try {
        await sendButton.click({ timeout: 3000 });
        return true;
      } catch {}
    }

    return originalSendPrompt.call(this, page, composer);
  } finally {
    pendingAttachments.delete(page);
  }
};

module.exports = {
  composerAttachmentState,
  waitForAttachmentReady
};
