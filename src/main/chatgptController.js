const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { clickFirstVisible, automationError } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const GENERATION_PROMPT = `-Copy slogan and create a style
-make It Clean and Print On demand Friendly
-avoid using specific colors and elements from last output unless i told you
-make sure that the font styling is different
-add some few elements. but don't add too much
-make the text Large Easy To Read
-Don't Use Cursive text unless defined.
-avoid adding element's on text
-make sure that the text are large and uniformed
-Avoid Using Ribbons
-don't do that fake transparent background. i want real transparent background
-make output 4:5
-Don't USE AI Brush Text
-DON'T ADD TEXT IF THE REFERENCE DOESN'T HAVE ONE.
-IF THE reference is only text. add some few elements based on the text`;

function imageFormatFromBytes(buffer, contentType = '') {
  if (buffer?.length >= 12) {
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  }
  if (/image\/png/i.test(contentType)) return { ext: '.png', mime: 'image/png' };
  if (/image\/webp/i.test(contentType)) return { ext: '.webp', mime: 'image/webp' };
  if (/image\/jpe?g/i.test(contentType)) return { ext: '.jpg', mime: 'image/jpeg' };
  return null;
}

class ChatGPTController {
  constructor({ sessions, projects, podRules }) {
    this.sessions = sessions;
    this.projects = projects;
    this.podRules = podRules;
  }

  buildPrompt() {
    return GENERATION_PROMPT;
  }

  async assertNoHumanGate(page) {
    if (await this.sessions.detectHumanVerification(page)) {
      const error = new Error('ChatGPT requires human verification. Complete the Cloudflare “Verify you are human” challenge manually in normal Edge, then retry this job. ZeroPOD will not automate or bypass the challenge.');
      error.code = 'HUMAN_VERIFICATION_REQUIRED';
      throw error;
    }
  }

  composerLocator(page) {
    const selectors = [
      '#prompt-textarea',
      '[data-testid="composer-text-input"]',
      'textarea[placeholder*="Message" i]',
      'textarea',
      '[contenteditable="true"][data-placeholder]',
      '[contenteditable="true"]'
    ];
    return page.locator(selectors.map((selector) => `${selector}:visible`).join(',')).first();
  }

  async locateComposer(page) {
    await this.assertNoHumanGate(page);
    const composer = this.composerLocator(page);
    await composer.waitFor({ state: 'visible', timeout: 9000 });
    return composer;
  }

  async openPreferredThread(page) {
    const currentUrl = page.url();
    if (/^https:\/\/chatgpt\.com\/c\//i.test(currentUrl)) {
      this.sessions.rememberThreadUrl('chatgpt', currentUrl);
      return;
    }
    const saved = this.sessions.getLastThreadUrl('chatgpt');
    if (/^https:\/\/chatgpt\.com\/c\//i.test(saved || '')) {
      await page.goto(saved, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
  }

  async ensureReady(page) {
    await page.bringToFront();
    if (!page.url().startsWith('https://chatgpt.com')) {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    await this.assertNoHumanGate(page);
    const auth = await this.sessions.detectAuthState('chatgpt', page);
    if (auth.status === 'needs-login') throw new Error('ChatGPT is not signed in. Open Connections → ChatGPT → Open Login Browser, finish login, then Test Session.');
    try {
      return await this.locateComposer(page);
    } catch (error) {
      if (error.code === 'HUMAN_VERIFICATION_REQUIRED') throw error;
      const saved = this.sessions.getLastThreadUrl('chatgpt');
      if (/^https:\/\/chatgpt\.com\/c\//i.test(saved || '') && page.url() !== saved) {
        await page.goto(saved, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await this.assertNoHumanGate(page);
        return this.locateComposer(page);
      }
      throw error;
    }
  }

  async attachReference(page, referencePath) {
    await this.assertNoHumanGate(page);
    let input = page.locator('input[type="file"]').first();
    if (!(await input.count())) {
      await clickFirstVisible([
        page.locator('button[data-testid*="composer" i][aria-label*="add" i]').first(),
        page.locator('button[data-testid*="attach" i]').first(),
        page.getByRole('button', { name: /add files|attach|upload|photos|files|add/i }).first(),
        page.locator('button[aria-label*="add files" i]').first(),
        page.locator('button[aria-label*="attach" i]').first(),
        page.locator('button[aria-label*="upload" i]').first()
      ], { timeout: 5000 });
      await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 5000 });
      input = page.locator('input[type="file"]').first();
    }
    if (!(await input.count())) throw new Error('Could not find ChatGPT image upload input.');
    await input.setInputFiles(referencePath);
    await input.evaluate((element) => {
      if (!element.files || element.files.length < 1) throw new Error('ChatGPT did not accept the reference file.');
    });
    return true;
  }

  async fillPrompt(page, prompt) {
    await this.assertNoHumanGate(page);
    const composer = await this.locateComposer(page);
    await composer.click();
    const tagName = await composer.evaluate((element) => element.tagName.toLowerCase());
    if (tagName === 'textarea' || tagName === 'input') {
      await composer.fill(prompt);
    } else {
      await composer.fill(prompt).catch(async () => composer.pressSequentially(prompt, { delay: 1 }));
    }
    return composer;
  }

  async sendPrompt(page, composer) {
    await this.assertNoHumanGate(page);
    const sendSelectors = [
      'button[data-testid="send-button"]:visible',
      'button[data-testid*="send" i]:visible',
      'button[aria-label*="send" i]:visible'
    ];
    const sendButton = page.locator(sendSelectors.join(',')).first();
    try {
      await sendButton.waitFor({ state: 'visible', timeout: 12000 });
      await sendButton.waitFor({ state: 'attached', timeout: 12000 });
      await sendButton.click({ timeout: 12000 });
    } catch {
      await composer.press('Enter');
    }
    return true;
  }

  async snapshotAssistantState(page) {
    const messages = page.locator('[data-message-author-role="assistant"]');
    const count = await messages.count();
    const ids = await messages.evaluateAll((nodes) => nodes.map((node, index) => node.getAttribute('data-message-id') || node.closest('[data-message-id]')?.getAttribute('data-message-id') || `assistant-${index}`)).catch(() => []);
    const imageSources = await messages.locator('img').evaluateAll((images) => images.map((img) => img.currentSrc || img.src).filter(Boolean)).catch(() => []);
    return { count, ids: new Set(ids), imageSources: new Set(imageSources) };
  }

  async waitForNewAssistantResponse(page, baseline, onProgress) {
    const started = Date.now();
    while (Date.now() - started < 90000) {
      await this.assertNoHumanGate(page);
      const messages = page.locator('[data-message-author-role="assistant"]');
      const count = await messages.count();
      if (count > baseline.count) {
        const newest = messages.nth(count - 1);
        const id = await newest.evaluate((node, index) => node.getAttribute('data-message-id') || node.closest('[data-message-id]')?.getAttribute('data-message-id') || `assistant-${index}`).catch(() => null);
        if (!id || !baseline.ids.has(id)) {
          if (typeof onProgress === 'function') onProgress('Image generation in progress');
          return newest;
        }
      }
      await wait(700);
    }
    throw new Error('ChatGPT did not create a new assistant response for the generation request.');
  }

  async getResponseAssetCandidates(messageLocator, baselineSources) {
    const candidates = await messageLocator.evaluate((message) => {
      const turn = message.closest('article') || message.closest('[data-testid^="conversation-turn-"]') || message.parentElement || message;
      const results = [];
      const add = (src, score, width = 0, height = 0, alt = '') => {
        if (!src || !/^((blob:|data:image\/|https?:\/\/))/i.test(src)) return;
        results.push({ src, score, width, height, alt });
      };
      for (const img of turn.querySelectorAll('img')) {
        const rect = img.getBoundingClientRect();
        const width = img.naturalWidth || rect.width || 0;
        const height = img.naturalHeight || rect.height || 0;
        const alt = img.alt || '';
        const primary = img.currentSrc || img.src || '';
        let score = Math.min(width * height / 1000, 5000);
        if (/generated|create|imagegen|dall/i.test(`${alt} ${primary}`)) score += 5000;
        if (/files\.oaiusercontent\.com|blob:|backend-api|imagegen/i.test(primary)) score += 3000;
        if (width >= 384 && height >= 384) score += 2500;
        add(primary, score, width, height, alt);
        if (img.srcset) {
          for (const part of img.srcset.split(',')) add(part.trim().split(/\s+/)[0], score - 10, width, height, alt);
        }
        const anchor = img.closest('a[href]');
        if (anchor) add(anchor.href, score - 20, width, height, alt);
      }
      return results;
    }).catch(() => []);

    const seen = new Set();
    return candidates
      .filter((item) => item.src && !baselineSources.has(item.src) && !seen.has(item.src) && seen.add(item.src))
      .sort((a, b) => b.score - a.score);
  }

  async fetchImageBytes(page, source) {
    if (/^data:image\//i.test(source)) {
      const match = source.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
      if (!match) throw new Error('Generated data URL could not be decoded.');
      const contentType = match[1] || '';
      const body = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
      return { body, contentType };
    }

    if (/^blob:/i.test(source)) {
      const encoded = await page.evaluate(async (src) => {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`);
        const type = response.headers.get('content-type') || '';
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        return { base64: btoa(binary), type };
      }, source);
      return { body: Buffer.from(encoded.base64, 'base64'), contentType: encoded.type || '' };
    }

    try {
      const response = await page.context().request.get(source, { timeout: 45000 });
      if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
      return { body: await response.body(), contentType: response.headers()['content-type'] || '' };
    } catch (requestError) {
      const encoded = await page.evaluate(async (src) => {
        const response = await fetch(src, { credentials: 'include' });
        if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`);
        const type = response.headers.get('content-type') || '';
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        return { base64: btoa(binary), type };
      }, source).catch((browserError) => {
        throw new Error(`Could not fetch generated image bytes. ${requestError.message} ${browserError.message}`);
      });
      return { body: Buffer.from(encoded.base64, 'base64'), contentType: encoded.type || '' };
    }
  }

  nextDraftPath(projectDir, ext) {
    for (let index = 1; index <= 999; index += 1) {
      const candidate = path.join(projectDir, `chatgpt-draft-${String(index).padStart(2, '0')}${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error('Too many ChatGPT draft files exist in this project.');
  }

  async saveGeneratedAsset(page, source, projectDir) {
    const { body, contentType } = await this.fetchImageBytes(page, source);
    if (!body || body.length < 8192) throw new Error('Captured generated image was unexpectedly small.');
    const format = imageFormatFromBytes(body, contentType);
    if (!format) throw new Error(`Generated asset is not a supported PNG, WebP, or JPEG image (${contentType || 'unknown MIME'}).`);

    const savePath = this.nextDraftPath(projectDir, format.ext);
    fs.writeFileSync(savePath, body);
    try {
      const metadata = await sharp(savePath, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) {
        throw new Error(`Generated image dimensions are invalid (${metadata.width || 0}×${metadata.height || 0}).`);
      }
      return { savePath, metadata, mime: format.mime };
    } catch (error) {
      fs.rmSync(savePath, { force: true });
      throw error;
    }
  }

  async captureGeneratedImage(page, projectId, baseline, step) {
    const projectDir = this.projects.getProjectDir(projectId);
    step('Waiting for ChatGPT response');
    const response = await this.waitForNewAssistantResponse(page, baseline, step);
    const started = Date.now();
    let lastError = null;

    while (Date.now() - started < 360000) {
      await this.assertNoHumanGate(page);
      const currentUrl = page.url();
      if (/^https:\/\/chatgpt\.com\/c\//i.test(currentUrl)) this.sessions.rememberThreadUrl('chatgpt', currentUrl);
      const candidates = await this.getResponseAssetCandidates(response, baseline.imageSources);
      for (const candidate of candidates) {
        try {
          step('Generated image detected');
          step('Saving generated image');
          const saved = await this.saveGeneratedAsset(page, candidate.src, projectDir);
          this.projects.update(projectId, {
            status: 'awaiting-review',
            generatedImagePath: saved.savePath,
            generatedImage: {
              mime: saved.mime,
              width: saved.metadata.width,
              height: saved.metadata.height,
              hasAlpha: Boolean(saved.metadata.hasAlpha),
              source: candidate.src.startsWith('blob:') ? 'blob' : 'asset-url'
            },
            automationStep: 'Ready for review',
            chatgptError: null
          });
          step('Ready for review');
          return { ok: true, path: saved.savePath, method: 'assistant-response-asset' };
        } catch (error) {
          lastError = error;
        }
      }
      step('Image generation in progress');
      await wait(900);
    }

    const error = new Error(`ChatGPT created a response, but ZeroPOD could not extract a valid generated image asset${lastError ? `: ${lastError.message}` : '.'}`);
    this.projects.update(projectId, {
      status: 'chatgpt-recovery-needed',
      automationStep: 'Generated image capture needs attention',
      chatgptError: automationError('chatgpt', 'capture-generated-image', error, 'Keep the completed ChatGPT generation open, then Retry. ZeroPOD captures the original response image asset directly and does not use browser downloads or screenshots.')
    });
    throw error;
  }

  async newChat() {
    const { page } = await this.sessions.ensureService('chatgpt');
    await page.bringToFront();
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.assertNoHumanGate(page);
    await this.locateComposer(page);
    this.sessions.rememberThreadUrl('chatgpt', 'https://chatgpt.com/');
    return { ok: true, message: 'Fresh ChatGPT conversation is ready. The next generation will use this chat and ZeroPOD will remember its thread URL after the prompt is sent.' };
  }

  async start({ referencePath, sourceUrl = '', reviewNotes = '', existingProjectId = null, onStep = null }) {
    if (!referencePath || !fs.existsSync(referencePath)) throw new Error('Reference image is missing.');
    const project = existingProjectId ? this.projects.read(existingProjectId) : this.projects.create({ referencePath, sourceUrl });
    const step = (message) => {
      if (typeof onStep === 'function') onStep(message);
      this.projects.update(project.id, { automationStep: message });
    };

    try {
      step('Opening saved ChatGPT thread');
      const { page } = await this.sessions.ensureService('chatgpt');
      await this.openPreferredThread(page);

      step('Waiting for composer');
      await this.ensureReady(page);
      const baseline = await this.snapshotAssistantState(page);

      step('Uploading reference image');
      await this.attachReference(page, project.referencePath);
      step('Reference upload complete');

      step('Pasting generation prompt');
      const composer = await this.fillPrompt(page, this.buildPrompt());
      step('Sending prompt');
      await this.sendPrompt(page, composer);

      const currentUrl = page.url();
      if (/^https:\/\/chatgpt\.com\/c\//i.test(currentUrl)) this.sessions.rememberThreadUrl('chatgpt', currentUrl);

      this.projects.update(project.id, { status: 'generating', chatgptError: null });
      this.captureGeneratedImage(page, project.id, baseline, step).catch(async (error) => {
        if (error.code === 'HUMAN_VERIFICATION_REQUIRED') await this.sessions.login('chatgpt').catch(() => {});
      });

      return {
        ok: true,
        projectId: project.id,
        status: 'generating',
        message: 'Generation submitted. ZeroPOD is watching the new ChatGPT response and will capture the original generated image asset automatically.'
      };
    } catch (error) {
      const human = error.code === 'HUMAN_VERIFICATION_REQUIRED';
      if (human) await this.sessions.login('chatgpt').catch(() => {});
      const recovery = human
        ? { service: 'chatgpt', step: 'human-verification', message: error.message, recovery: 'Complete the human-verification challenge manually in the normal Edge window ZeroPOD opened, close it if it remains open, then retry. ZeroPOD does not automate or bypass verification.' }
        : automationError('chatgpt', 'generation', error, 'Open ChatGPT from Connections, confirm you are signed in and the composer is usable, then retry the project.');
      this.projects.update(project.id, { status: 'chatgpt-recovery-needed', chatgptError: recovery, automationStep: human ? 'Human verification required' : 'Generation failed' });
      throw new Error(recovery.message);
    }
  }
}

module.exports = { ChatGPTController, GENERATION_PROMPT };
