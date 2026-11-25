const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pendingUploads = new WeakMap();
const postSendBaselines = new WeakMap();
const dirtyPages = new WeakSet();

const previousSnapshot = ChatGPTController.prototype.snapshotAssistantState;
const previousSendPrompt = ChatGPTController.prototype.sendPrompt;

async function composerVisible(controller, page, timeout = 700) {
  try {
    const composer = controller.composerLocator(page);
    await composer.waitFor({ state: 'visible', timeout });
    return composer;
  } catch {
    return null;
  }
}

async function allImageSources(page) {
  return page.locator('img').evaluateAll((images) => images
    .map((img) => img.currentSrc || img.src || '')
    .filter(Boolean)).catch(() => []);
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function validThread(controller, value) {
  if (typeof controller.sessions.isValidChatGPTThreadUrl === 'function') {
    return controller.sessions.isValidChatGPTThreadUrl(value);
  }
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') return false;
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9-]+)$/);
    return Boolean(match && match[1].length >= 20 && !/^local-chatgpt/i.test(match[1]));
  } catch {
    return false;
  }
}

// Do not navigate away from an already-usable ChatGPT composer. This removes the
// largest avoidable delay in live runs and still remembers a real thread when the
// current tab is already inside one.
ChatGPTController.prototype.openPreferredThread = async function openPreferredThreadLive(page) {
  if (page.url().startsWith('https://chatgpt.com')) {
    const composer = await composerVisible(this, page, 900);
    if (composer) {
      if (validThread(this, page.url())) this.sessions.rememberThreadUrl('chatgpt', page.url());
      return;
    }
  }

  const saved = this.sessions.getLastThreadUrl('chatgpt');
  if (saved && validThread(this, saved)) {
    try {
      await page.goto(saved, { waitUntil: 'domcontentloaded', timeout: 6000 });
      if (await composerVisible(this, page, 2200)) return;
    } catch {}
    this.sessions.clearLastThreadUrl?.('chatgpt');
  }

  if (!page.url().startsWith('https://chatgpt.com')) {
    try {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch (error) {
      if (!page.url().startsWith('https://chatgpt.com')) throw error;
    }
  }
};

ChatGPTController.prototype.ensureReady = async function ensureReadyLive(page) {
  await page.bringToFront();

  let composer = await composerVisible(this, page, 900);
  if (composer) return composer;

  if (!page.url().startsWith('https://chatgpt.com')) {
    try {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch (error) {
      if (!page.url().startsWith('https://chatgpt.com')) throw error;
    }
  }

  await this.assertNoHumanGate(page);
  const auth = await this.sessions.detectAuthState('chatgpt', page);
  if (auth.status === 'needs-login') {
    throw new Error('ChatGPT is not signed in. Open Connections → ChatGPT → Open Login Browser, finish login in Chrome, then Test Session.');
  }

  composer = await composerVisible(this, page, 7000);
  if (composer) return composer;

  throw new Error('ChatGPT opened, but the message composer did not become ready. ZeroPOD did not paste the image or prompt into an unready page.');
};

async function attachmentState(page, beforeSources) {
  return page.evaluate((baseline) => {
    const composer = document.querySelector('#prompt-textarea, [data-testid="composer-text-input"], textarea[placeholder*="Message" i], textarea, [contenteditable="true"]');
    const baselineSet = new Set(baseline || []);
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };
    const composerRect = composer?.getBoundingClientRect?.() || null;
    const near = (element) => {
      if (!visible(element) || element.closest('[data-message-author-role]')) return false;
      if (!composerRect) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom >= composerRect.top - 420
        && rect.top <= composerRect.bottom + 180
        && rect.right >= composerRect.left - 220
        && rect.left <= composerRect.right + 220;
    };

    const images = [...document.querySelectorAll('img')].filter((img) => {
      if (!near(img)) return false;
      const rect = img.getBoundingClientRect();
      return rect.width >= 28 && rect.height >= 28;
    });
    const sources = images.map((img) => img.currentSrc || img.src || '').filter(Boolean);
    const newImage = sources.some((src) => !baselineSet.has(src));
    const attachmentElements = [...document.querySelectorAll('[data-testid*="attachment" i], [data-testid*="upload" i], [data-testid*="file" i], button[aria-label*="remove" i], button[title*="remove" i]')].filter(near);
    const attachmentNode = attachmentElements.length > 0;
    const attachmentCount = attachmentElements.length;
    const attachmentLabels = attachmentElements.map(el =>
      [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'), el.textContent]
        .filter(Boolean).join(' ')
    ).filter(Boolean);
    const busy = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-state="loading"], [data-testid*="uploading" i], [data-testid*="progress" i]')].some(near);
    const send = [...document.querySelectorAll('button[data-testid="send-button"], button[data-testid*="send" i], button[aria-label*="send" i]')].find(near);
    const sendEnabled = Boolean(send && !send.disabled && send.getAttribute('aria-disabled') !== 'true');
    let text = '';
    if (composer) {
      let node = composer;
      for (let i = 0; node && i < 6; i += 1, node = node.parentElement) text += ` ${node.innerText || ''}`;
    }
    const failed = /upload failed|failed to upload|couldn['’]t upload|unsupported file|file too large/i.test(text);
    return { newImage, attachmentNode, attachmentCount, attachmentLabels, busy, sendEnabled, failed };
  }, beforeSources).catch(() => ({ newImage: false, attachmentNode: false, attachmentCount: 0, attachmentLabels: [], busy: false, sendEnabled: false, failed: false }));
}

async function findComposerFileInput(page) {
  // ChatGPT may leave hidden <input type=file> elements from previous messages.
  // The FIRST input is often stale on job #2. Prefer the newest active image
  // input; never assume the oldest hidden input belongs to the live composer.
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index);
    const accept = await input.getAttribute('accept').catch(() => '');
    if (accept && !/(?:image|\\.png|\\.jpe?g|\\.webp|\\.gif)/i.test(accept)) continue;
    if (await input.isEnabled().catch(() => true)) return input;
  }
  return null;
}

async function setInputBytes(input, referencePath) {
  const buffer = fs.readFileSync(referencePath);
  await input.setInputFiles({
    name: path.basename(referencePath),
    mimeType: mimeFromPath(referencePath),
    buffer
  }, { timeout: 3500 });
}

async function injectFast(page, referencePath) {
  let input = await findComposerFileInput(page);
  if (input) {
    await setInputBytes(input, referencePath);
    return 'memory-file-input';
  }

  const plus = page.locator('button[data-testid="composer-plus-btn"]:visible, button[aria-label*="add" i]:visible').first();
  if (await plus.count()) {
    await plus.click({ timeout: 1500 }).catch(() => {});
    await wait(120);
    input = await findComposerFileInput(page);
    if (input) {
      await setInputBytes(input, referencePath);
      return 'composer-plus-file-input';
    }
  }

  const menuItems = [
    page.getByRole('menuitem', { name: /upload|photo|file/i }).first(),
    page.getByRole('button', { name: /upload from computer|add photos|add files|photos.*files/i }).first(),
    page.getByText(/upload from computer|add photos(?:\s*&\s*| and )files/i).first()
  ];

  for (const item of menuItems) {
    try {
      await item.waitFor({ state: 'visible', timeout: 350 });
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 1200 }).catch(() => null);
      await item.click({ timeout: 900 });
      const chooser = await chooserPromise;
      if (chooser) {
        const buffer = fs.readFileSync(referencePath);
        await chooser.setFiles({ name: path.basename(referencePath), mimeType: mimeFromPath(referencePath), buffer });
        return 'native-file-chooser-memory';
      }
      input = await findComposerFileInput(page);
      if (input) {
        await setInputBytes(input, referencePath);
        return 'upload-menu-file-input';
      }
    } catch {}
  }

  throw new Error('ChatGPT composer is ready, but ZeroPOD could not access its image upload control.');
}

function hasNewReferenceEvidence(state, baseline) {
  const changedLabel = (state.attachmentLabels || []).some(label =>
    !(baseline.attachmentLabels || []).includes(label)
  );
  return Boolean(state.newImage
    || state.attachmentCount > (baseline.attachmentCount || 0)
    || (changedLabel && state.attachmentCount > 0));
}

async function waitForReferenceEvidence(page, beforeSources, baseline, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await attachmentState(page, beforeSources);
    if (state.failed) throw new Error('ChatGPT reported that the reference image upload failed.');
    if (hasNewReferenceEvidence(state, baseline) && !state.busy) return true;
    await wait(160);
  }
  return false;
}

ChatGPTController.prototype.attachReference = async function attachReferenceLive(page, referencePath) {
  await this.assertNoHumanGate(page);
  pendingUploads.delete(page);
  if (dirtyPages.has(page)) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.ensureReady(page);
  }
  dirtyPages.add(page);
  if (!(await composerVisible(this, page, 2000))) throw new Error('ChatGPT composer is not ready for the reference image.');

  // Only allow a new prompt to be pasted once its actual image is visible in
  // the active composer. If Chrome accepted bytes into a stale input, refresh
  // the SAME conversation (not New Chat) and attach to its new composer.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await this.assertNoHumanGate(page);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
      await this.ensureReady(page);
    }
    const beforeSources = await allImageSources(page);
    const baseline = await attachmentState(page, beforeSources);
    const composer = await composerVisible(this, page, 2000);
    if (!composer) throw new Error('Composer disappeared before upload.');
    if ((await composerText(composer)).trim() || (baseline.attachmentLabels || []).some(label => /remove (?:file|image|attachment)|delete (?:file|image|attachment)/i.test(label))) {
      if (attempt === 0) continue;
      throw new Error('Composer still contains an unsent draft or attachment after recovery. Clear it before retrying.');
    }
    let method = '';
    try {
      method = await injectFast(page, referencePath);
    } catch (error) {
      if (attempt === 1) throw error;
      continue;
    }
    const ready = await waitForReferenceEvidence(
      page, beforeSources, baseline, attempt === 0 ? 45000 : 60000
    );
    if (ready) {
      pendingUploads.set(page, { referencePath, beforeSources, baseline, method, injectedAt: Date.now() });
      return true;
    }
  }
  throw new Error(
    'ChatGPT accepted the reference file but did not show its preview after two attempts. ' +
    'ZeroPOD refreshed the existing conversation once. Nothing was sent without the image; ' +
    'select this row and use Retry Design.'
  );
};

async function composerText(composer) {
  return composer.evaluate((el) => {
    if ('value' in el) return String(el.value || '');
    return String(el.innerText || el.textContent || '');
  }).catch(() => '');
}

ChatGPTController.prototype.fillPrompt = async function fillPromptLive(page, prompt) {
  await this.assertNoHumanGate(page);
  const composer = await composerVisible(this, page, 1600);
  if (!composer) throw new Error('ChatGPT composer disappeared before the generation prompt could be pasted.');

  // Avoid locator.fill() here: on the current ChatGPT contenteditable it can sit on
  // actionability checks for ~30 seconds. keyboard.insertText sends one immediate
  // input operation and preserves newlines without per-character typing delays.
  try {
    await composer.click({ timeout: 1200 });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(prompt);
  } catch {}

  let value = await composerText(composer);
  if (!value.includes(prompt.split('\n')[0]) || value.length < Math.min(prompt.length * 0.75, 120)) {
    await composer.evaluate((el, text) => {
      el.focus();
      if ('value' in el) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, text); else el.value = text;
      } else {
        el.innerHTML = '';
        const lines = String(text).split('\n');
        for (const line of lines) {
          const p = document.createElement('p');
          p.textContent = line || '\u00a0';
          el.appendChild(p);
        }
      }
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, prompt);
    await wait(80);
    value = await composerText(composer);
  }

  if (!value.includes(prompt.split('\n')[0]) || value.length < Math.min(prompt.length * 0.75, 120)) {
    throw new Error('ChatGPT accepted the image, but ZeroPOD could not verify that the generation prompt was pasted. Nothing was sent.');
  }
  return composer;
};

async function waitForUploadReady(page, pending, timeoutMs = 90000) {
  const started = Date.now();
  let sawAttachment = false;
  while (Date.now() - started < timeoutMs) {
    const state = await attachmentState(page, pending.beforeSources);
    if (state.failed) throw new Error('ChatGPT reported that the reference image upload failed.');
    // A prior message may still show an attachment tile near the composer.
    // Only evidence NEW since this row's upload can authorize sending.
    if (hasNewReferenceEvidence(state, pending.baseline || {})) sawAttachment = true;
    if (sawAttachment && !state.busy && state.sendEnabled) return true;
    await wait(100);
  }
  throw new Error(sawAttachment
    ? 'The reference image is visible in ChatGPT but did not become send-ready within 90 seconds. The prompt was left in the composer and was not sent without a confirmed image.'
    : 'Chrome accepted the reference file, but ChatGPT never showed its attachment preview. The prompt was left in the composer and was not sent without the image.');
}

// Use actual message identities, not image URLs or network arrival order.
async function conversationTurns(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-message-author-role]')].map(el => ({
    role: el.getAttribute('data-message-author-role'),
    id: el.getAttribute('data-message-id') || el.closest('[data-message-id]')?.getAttribute('data-message-id') || '',
    text: (el.innerText || '').replace(/\s+/g, ' ').trim()
  })));
}

ChatGPTController.prototype.sendPrompt = async function sendPromptLive(page, composer) {
  const pending = pendingUploads.get(page);
  postSendBaselines.delete(page);
  try {
    if (pending) await waitForUploadReady(page, pending, 90000);
    const prompt = (await composerText(composer)).replace(/\s+/g, ' ').trim();
    if (!prompt) throw new Error('Cannot submit an empty generation prompt.');
    const before = await conversationTurns(page);
    const known = new Set(before.map(turn => turn.id).filter(Boolean));
    const sources = new Set(await allImageSources(page));
    const result = await previousSendPrompt.call(this, page, composer);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const turns = await conversationTurns(page);
      const user = turns.filter(t => t.role === 'user').at(-1);
      if (user?.id && !known.has(user.id) && user.text.includes(prompt)) {
        postSendBaselines.set(page, { userId: user.id, known, sources });
        return result;
      }
      await wait(250);
    }
    throw new Error('ChatGPT did not confirm a new user message matching this job. No image will be accepted.');
  } finally {
    pendingUploads.delete(page);
  }
};

ChatGPTController.prototype.snapshotAssistantState = async function snapshotAssistantStateLive(page) {
  const baseline = await previousSnapshot.call(this, page);
  return { ...baseline, allImageSources: new Set(await allImageSources(page)) };
};

// Only images inside the assistant message following the confirmed user turn
// may be saved. Never accept a global network asset or a user attachment.
async function generatedDomCandidates(page, submission) {
  return page.evaluate(({userId, known, sources}) => {
    const messages = [...document.querySelectorAll('[data-message-author-role]')];
    const idOf = el => el.getAttribute('data-message-id') || el.closest('[data-message-id]')?.getAttribute('data-message-id') || '';
    const index = messages.findIndex(el => idOf(el) === userId && el.getAttribute('data-message-author-role') === 'user');
    if (index < 0) return [];
    const later = messages.slice(index + 1);
    if (later.some(el => el.getAttribute('data-message-author-role') === 'user')) return [];
    const assistant = later.filter(el => el.getAttribute('data-message-author-role') === 'assistant').at(-1);
    const id = assistant && idOf(assistant);
    if (!id || known.includes(id)) return [];
    const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if ([...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="stop generating" i],button[aria-label*="cancel generation" i]')].some(visible)) return [];
    if ([...assistant.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-state="loading"]')].some(visible)) return [];
    return [...assistant.querySelectorAll('img')].filter(img => {
      const src = img.currentSrc || img.src;
      return img.closest('[data-message-author-role]') === assistant && img.complete && visible(img)
        && img.naturalWidth >= 512 && img.naturalHeight >= 512 && src && !sources.includes(src);
    }).map(img => ({id, src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight}))
      .sort((x,y) => y.width*y.height - x.width*x.height);
  }, {userId: submission.userId, known: [...submission.known], sources: [...submission.sources]});
}

ChatGPTController.prototype.captureGeneratedImage = async function captureGeneratedImageLive(page, projectId, baseline, step) {
  const submission = postSendBaselines.get(page);
  const projectDir = this.projects.getProjectDir(projectId);
  const deadline = Date.now() + 330000;
  const stable = new Map();
  let lastError;
  try {
    if (!submission) throw new Error('Missing confirmed submission identity.');
    step('Waiting for verified assistant artwork');
    while (Date.now() < deadline) {
      await this.assertNoHumanGate(page);
      const candidates = await generatedDomCandidates(page, submission);
      const active = new Set(candidates.map(c => c.id + '|' + c.src));
      for (const key of stable.keys()) if (!active.has(key)) stable.delete(key);
      for (const candidate of candidates) {
        const key = candidate.id + '|' + candidate.src;
        if (!stable.has(key)) stable.set(key, Date.now());
        if (Date.now() - stable.get(key) < 1800) continue;
        try {
          const saved = await this.saveGeneratedAsset(page, candidate.src, projectDir);
          // Recheck ownership after the download, before publishing project state.
          const current = await generatedDomCandidates(page, submission);
          if (!current.some(c => c.id === candidate.id && c.src === candidate.src)) {
            fs.rmSync(saved.savePath, {force:true});
            continue;
          }
          step('Generated image verified');
          this.projects.update(projectId, {
            status: 'awaiting-review', generatedImagePath: saved.savePath,
            generatedImage: {mime:saved.mime,width:saved.metadata.width,height:saved.metadata.height,hasAlpha:Boolean(saved.metadata.hasAlpha),source:'verified-assistant-image',assistantMessageId:candidate.id,userMessageId:submission.userId},
            automationStep:'Ready for review',chatgptError:null
          });
          dirtyPages.delete(page);
          return {ok:true,path:saved.savePath,method:'verified-assistant-image'};
        } catch (error) { lastError = error; }
      }
      await wait(400);
    }
    throw new Error('No verified artwork in this job’s assistant response.' + (lastError ? ' ' + lastError.message : ''));
  } catch (error) {
    this.projects.update(projectId,{status:'chatgpt-recovery-needed',generatedImagePath:null,generatedImage:null,automationStep:'Image capture failed',chatgptError:{service:'chatgpt',step:'capture-generated-image',message:error.message}});
    throw error;
  } finally {
    postSendBaselines.delete(page);
    if (baseline?.networkObserver) {
      baseline.networkObserver.generationStartedAt = 0;
      baseline.networkObserver.assets = [];
    }
  }
};

module.exports = { findComposerFileInput, hasNewReferenceEvidence, waitForReferenceEvidence, generatedDomCandidates };
