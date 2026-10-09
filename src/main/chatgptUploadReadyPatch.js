const path = require('path');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalSendPrompt = ChatGPTController.prototype.sendPrompt;

// Keep the upload state separate from prompt entry. The reference file is injected
// first, the prompt is pasted as soon as ChatGPT accepts the file locally, and only
// the final Send action waits for the attachment preview/upload to become ready.
// This prevents a slow upload from leaving the composer blank for up to a minute.
const pendingAttachments = new WeakMap();

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

    // Do not depend on a fragile form/ancestor relationship. ChatGPT has moved the
    // attachment preview outside the editor wrapper in several UI revisions. Detect
    // visible attachment-like UI by geometry around the composer instead.
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
  // Fast path: ChatGPT often keeps a hidden file input mounted even though the +
  // menu is closed. setInputFiles works on hidden inputs and avoids opening menus.
  let input = await findUploadInput(page);
  if (input) {
    await setFilesOnInput(input, referencePath);
    return { method: 'existing-file-input' };
  }

  // Current ChatGPT uses composer-plus-btn. Keep several short fallbacks, but do
  // not wait five seconds per selector like the previous implementation did.
  const addControl = await clickFirstFast([
    page.locator('button[data-testid="composer-plus-btn"]:visible').first(),
    page.locator('button[data-testid*="composer" i][aria-label*="add" i]:visible').first(),
    page.locator('button[aria-label*="add files" i]:visible').first(),
    page.locator('button[aria-label*="attach" i]:visible').first(),
    page.locator('button[aria-label*="upload" i]:visible').first(),
    page.getByRole('button', { name: /add files|attach|upload|photos|files|add/i }).first()
  ], 500);

  if (!addControl) throw new Error('Could not find ChatGPT’s add-file control.');

  // In some UI versions clicking + mounts the file input immediately.
  const inputAfterPlus = page.locator('input[type="file"]').first();
  await inputAfterPlus.waitFor({ state: 'attached', timeout: 1200 }).catch(() => {});
  input = await findUploadInput(page);
  if (input) {
    await setFilesOnInput(input, referencePath);
    return { method: 'plus-menu-file-input' };
  }

  // Other versions show an "Upload from computer / Add photos & files" menu item.
  // Capture the native chooser when present; otherwise use the input it mounts.
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
  // setInputFiles / fileChooser.setFiles already succeeded. Do not hold the prompt
  // hostage while ChatGPT finishes rendering its preview; Send will perform the
  // stricter readiness check below.
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
  const before = await composerAttachmentState(page, referencePath, []);

  const injectedAt = Date.now();
  const injection = await injectReferenceFile(page, referencePath);
  const pending = {
    referencePath,
    before,
    injection,
    injectedAt
  };
  pendingAttachments.set(page, pending);

  // Only a short acceptance wait happens here. This allows fillPrompt() to run
  // immediately instead of waiting up to 60 seconds before any text appears.
  await waitForAttachmentAccepted(page, pending, 1800);
  return true;
};

ChatGPTController.prototype.sendPrompt = async function sendPromptAfterUpload(page, composer) {
  await this.assertNoHumanGate(page);
  const pending = pendingAttachments.get(page);

  try {
    if (pending) await waitForAttachmentReady(page, pending, 25000);

    // The readiness check above already found an enabled Send button. Use a short
    // click path instead of another 12-second wait. Enter remains the compatibility
    // fallback for future markup changes.
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
