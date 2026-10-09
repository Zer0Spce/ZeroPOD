const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pendingUploads = new WeakMap();
const postSendBaselines = new WeakMap();

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
      if (!visible(element)) return false;
      if (!composerRect) return true;
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
    const attachmentNode = [...document.querySelectorAll('[data-testid*="attachment" i], [data-testid*="upload" i], [data-testid*="file" i], button[aria-label*="remove" i], button[title*="remove" i]')].some(near);
    const busy = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-state="loading"], [data-testid*="uploading" i], [data-testid*="progress" i]')].some(near);
    const send = [...document.querySelectorAll('button[data-testid="send-button"], button[data-testid*="send" i], button[aria-label*="send" i]')].find(near);
    const sendEnabled = Boolean(send && !send.disabled && send.getAttribute('aria-disabled') !== 'true');
    let text = '';
    if (composer) {
      let node = composer;
      for (let i = 0; node && i < 6; i += 1, node = node.parentElement) text += ` ${node.innerText || ''}`;
    }
    const failed = /upload failed|failed to upload|couldn['’]t upload|unsupported file|file too large/i.test(text);
    return { newImage, attachmentNode, busy, sendEnabled, failed };
  }, beforeSources).catch(() => ({ newImage: false, attachmentNode: false, busy: false, sendEnabled: false, failed: false }));
}

async function findComposerFileInput(page) {
  // Prefer image-accepting inputs. Passing the file bytes directly avoids Windows
  // path handoff delays and makes local acceptance effectively immediate.
  const imageInput = page.locator('input[type="file"][accept*="image" i]').first();
  if (await imageInput.count()) return imageInput;
  const generic = page.locator('input[type="file"]').first();
  if (await generic.count()) return generic;
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

ChatGPTController.prototype.attachReference = async function attachReferenceLive(page, referencePath) {
  await this.assertNoHumanGate(page);
  if (!(await composerVisible(this, page, 1000))) throw new Error('ChatGPT composer is not ready for the reference image.');

  const beforeSources = await allImageSources(page);
  const method = await injectFast(page, referencePath);
  pendingUploads.set(page, { referencePath, beforeSources, method, injectedAt: Date.now() });

  // setInputFiles/fileChooser.setFiles returning means Chrome accepted the local
  // file bytes. Do not block prompt entry behind the remote upload/preview.
  return true;
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

async function waitForUploadReady(page, pending, timeoutMs = 15000) {
  const started = Date.now();
  let sawAttachment = false;
  while (Date.now() - started < timeoutMs) {
    const state = await attachmentState(page, pending.beforeSources);
    if (state.failed) throw new Error('ChatGPT reported that the reference image upload failed.');
    if (state.newImage || state.attachmentNode) sawAttachment = true;
    if (sawAttachment && !state.busy && state.sendEnabled) return true;
    await wait(100);
  }
  throw new Error(sawAttachment
    ? 'The reference image is visible in ChatGPT but did not become send-ready within 15 seconds. The prompt was left in the composer and was not sent without a confirmed image.'
    : 'Chrome accepted the reference file, but ChatGPT never showed its attachment preview. The prompt was left in the composer and was not sent without the image.');
}

ChatGPTController.prototype.sendPrompt = async function sendPromptLive(page, composer) {
  const pending = pendingUploads.get(page);
  if (pending) await waitForUploadReady(page, pending, 15000);

  const result = await previousSendPrompt.call(this, page, composer);
  pendingUploads.delete(page);

  // Snapshot after Send so the user's uploaded reference image cannot be confused
  // with the later assistant-generated artwork.
  await wait(180);
  postSendBaselines.set(page, new Set(await allImageSources(page)));
  return result;
};

ChatGPTController.prototype.snapshotAssistantState = async function snapshotAssistantStateLive(page) {
  const baseline = await previousSnapshot.call(this, page);
  return { ...baseline, allImageSources: new Set(await allImageSources(page)) };
};

async function generatedDomCandidates(page, baselineSources) {
  return page.evaluate((baseline) => {
    const baselineSet = new Set(baseline || []);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 220 && rect.height >= 220 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };
    const out = [];
    for (const img of document.querySelectorAll('img')) {
      if (!visible(img)) continue;
      const src = img.currentSrc || img.src || '';
      if (!src || baselineSet.has(src)) continue;
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || 0;
      const height = img.naturalHeight || rect.height || 0;
      if (width < 256 || height < 256) continue;

      let node = img;
      let surroundingText = '';
      let actionText = '';
      let assistant = false;
      for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
        if (node.getAttribute?.('data-message-author-role') === 'assistant') assistant = true;
        const text = String(node.innerText || '');
        if (text.length > surroundingText.length && text.length < 8000) surroundingText = text;
        for (const button of node.querySelectorAll?.('button') || []) {
          actionText += ` ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.innerText || ''}`;
        }
      }

      let score = Math.min((width * height) / 1000, 8000);
      if (assistant) score += 10000;
      if (/edit|download|remove bg|erase|resize|share/i.test(`${surroundingText} ${actionText}`)) score += 9000;
      if (/oaiusercontent\.com|imagegen|dall|generated|blob:/i.test(src)) score += 5000;
      if (width >= 768 && height >= 768) score += 3500;
      out.push({ src, width, height, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }, [...baselineSources]).catch(() => []);
}

async function saveNetworkBytes(controller, projectId, asset) {
  const projectDir = controller.projects.getProjectDir(projectId);
  const savePath = controller.nextDraftPath(projectDir, asset.format?.ext || '.png');
  fs.writeFileSync(savePath, asset.body);
  try {
    const metadata = await sharp(savePath, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) throw new Error('Captured image dimensions were invalid.');
    controller.projects.update(projectId, {
      status: 'awaiting-review',
      generatedImagePath: savePath,
      generatedImage: {
        mime: asset.format?.mime || `image/${metadata.format || 'png'}`,
        width: metadata.width,
        height: metadata.height,
        hasAlpha: Boolean(metadata.hasAlpha),
        source: 'network-response'
      },
      automationStep: 'Ready for review',
      chatgptError: null
    });
    return { ok: true, path: savePath, method: 'network-response' };
  } catch (error) {
    fs.rmSync(savePath, { force: true });
    throw error;
  }
}

ChatGPTController.prototype.captureGeneratedImage = async function captureGeneratedImageLive(page, projectId, baseline, step) {
  const projectDir = this.projects.getProjectDir(projectId);
  const observer = baseline?.networkObserver;
  const baselineSources = postSendBaselines.get(page) || baseline?.allImageSources || new Set();
  const deadline = Date.now() + 360000;
  let lastError = null;
  let lastProgress = 0;

  step('Waiting for ChatGPT image');

  while (Date.now() < deadline) {
    await this.assertNoHumanGate(page);

    // Fastest path: save the actual image bytes already observed on the network.
    const networkAsset = observer?.assets?.[0];
    if (networkAsset) {
      try {
        step('Generated image detected');
        const saved = await saveNetworkBytes(this, projectId, networkAsset);
        step('Ready for review');
        postSendBaselines.delete(page);
        return saved;
      } catch (error) {
        lastError = error;
        observer.assets.shift();
      }
    }

    // Reliable UI fallback: once the large generated image is visibly present in
    // ChatGPT (including the Edit/Download image viewer shown in live testing),
    // fetch that exact img/blob source directly. Never click browser Download.
    const candidates = await generatedDomCandidates(page, baselineSources);
    for (const candidate of candidates) {
      try {
        step('Generated image detected');
        const saved = await this.saveGeneratedAsset(page, candidate.src, projectDir);
        this.projects.update(projectId, {
          status: 'awaiting-review',
          generatedImagePath: saved.savePath,
          generatedImage: {
            mime: saved.mime,
            width: saved.metadata.width,
            height: saved.metadata.height,
            hasAlpha: Boolean(saved.metadata.hasAlpha),
            source: candidate.src.startsWith('blob:') ? 'visible-blob' : 'visible-image-source'
          },
          automationStep: 'Ready for review',
          chatgptError: null
        });
        step('Ready for review');
        postSendBaselines.delete(page);
        return { ok: true, path: saved.savePath, method: 'visible-generated-image' };
      } catch (error) {
        lastError = error;
      }
    }

    if (Date.now() - lastProgress > 3000) {
      step('Image generation in progress');
      lastProgress = Date.now();
    }
    await wait(280);
  }

  postSendBaselines.delete(page);
  const suffix = lastError ? ` Last capture error: ${lastError.message}` : '';
  throw new Error(`ChatGPT did not expose a capturable generated image within 6 minutes.${suffix}`);
};

module.exports = {};
