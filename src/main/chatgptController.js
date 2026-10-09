const fs = require('fs');
const path = require('path');
const { retryStep, clickFirstVisible, automationError } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ChatGPTController {
  constructor({ sessions, projects, podRules }) { this.sessions = sessions; this.projects = projects; this.podRules = podRules; }

  buildPrompt(sourceUrl = '', reviewNotes = '') {
    const rules = this.podRules.map((rule) => `- ${rule}`).join('\n');
    return ['Create a new Print-On-Demand design using the attached reference image.','Copy the slogan exactly from the reference, but create a fresh visual style instead of cloning the original artwork.',sourceUrl ? `Source/reference URL for niche context only: ${sourceUrl}` : '','','Permanent ZeroPOD rules:',rules,'',reviewNotes ? `Revision notes from the previous review:\n${reviewNotes}` : '','','Generate the image only for this step. Do not generate listing metadata yet. We will review the image first.'].filter(Boolean).join('\n');
  }

  async assertNoHumanGate(page) {
    if (await this.sessions.detectHumanVerification(page)) {
      const error = new Error('ChatGPT requires human verification. Complete the Cloudflare “Verify you are human” challenge manually in normal Edge, then retry this job. ZeroPOD will not automate or bypass the challenge.');
      error.code = 'HUMAN_VERIFICATION_REQUIRED';
      throw error;
    }
  }

  async locateComposer(page) {
    const selectors = ['#prompt-textarea','[data-testid="composer-text-input"]','textarea[placeholder*="Message" i]','textarea','[contenteditable="true"][data-placeholder]','[contenteditable="true"]'];
    return retryStep('Locate ChatGPT composer', async () => {
      await this.assertNoHumanGate(page);
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try { await locator.waitFor({ state: 'visible', timeout: 2500 }); return locator; } catch {}
      }
      throw new Error('Could not find the ChatGPT message composer.');
    }, { attempts: 3, delayMs: 900 });
  }

  async ensureReady(page) {
    await page.bringToFront();
    if (!page.url().startsWith('https://chatgpt.com')) await retryStep('Open ChatGPT', () => page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }), { attempts: 2 });
    await page.waitForTimeout(1000);
    await this.assertNoHumanGate(page);
    const auth = await this.sessions.detectAuthState('chatgpt', page);
    if (auth.status === 'needs-login') throw new Error('ChatGPT is not signed in. Open Connections → ChatGPT → Open Login Browser, finish login, then Test Session.');
    try { return await this.locateComposer(page); }
    catch (error) {
      if (error.code === 'HUMAN_VERIFICATION_REQUIRED') throw error;
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1000);
      await this.assertNoHumanGate(page);
      return this.locateComposer(page);
    }
  }

  async attachReference(page, referencePath) {
    return retryStep('Attach ChatGPT reference image', async () => {
      await this.assertNoHumanGate(page);
      let input = page.locator('input[type="file"]').first();
      if (!(await input.count())) {
        await clickFirstVisible([page.locator('button[data-testid*="composer" i][aria-label*="add" i]').first(),page.locator('button[data-testid*="attach" i]').first(),page.getByRole('button', { name: /add files|attach|upload|photos|files|add/i }).first(),page.locator('button[aria-label*="add files" i]').first(),page.locator('button[aria-label*="attach" i]').first(),page.locator('button[aria-label*="upload" i]').first()], { timeout: 5000 });
        await page.waitForTimeout(700); input = page.locator('input[type="file"]').first();
      }
      if (!(await input.count())) throw new Error('Could not find ChatGPT image upload input.');
      await input.setInputFiles(referencePath); await page.waitForTimeout(1500); return true;
    }, { attempts: 3, delayMs: 900 });
  }

  async submitPrompt(page, prompt) {
    return retryStep('Submit ChatGPT generation prompt', async () => {
      await this.assertNoHumanGate(page);
      const composer = await this.locateComposer(page); await composer.click();
      const tagName = await composer.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === 'textarea' || tagName === 'input') await composer.fill(prompt); else await composer.fill(prompt).catch(async () => composer.pressSequentially(prompt, { delay: 1 }));
      await page.waitForTimeout(300);
      const sent = await clickFirstVisible([page.locator('button[data-testid="send-button"]').first(),page.locator('button[data-testid*="send" i]').first(),page.getByRole('button', { name: /^send$/i }).first(),page.locator('button[aria-label*="send" i]').first()], { timeout: 5000 });
      if (!sent) await composer.press('Enter'); return true;
    }, { attempts: 2, delayMs: 900 });
  }

  async snapshotImageSources(page) {
    return new Set(await page.locator('img').evaluateAll((images) => images.map((img) => img.currentSrc || img.src).filter(Boolean)).catch(() => []));
  }

  async findNewGeneratedImage(page, baselineSources) {
    const candidates = await page.locator('img').evaluateAll((images) => images.map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        src: img.currentSrc || img.src || '',
        alt: img.alt || '',
        width: img.naturalWidth || rect.width || 0,
        height: img.naturalHeight || rect.height || 0,
        visible: rect.width > 180 && rect.height > 180 && getComputedStyle(img).visibility !== 'hidden'
      };
    }).filter((item) => item.visible && item.src && item.width >= 384 && item.height >= 384)).catch(() => []);

    const fresh = candidates.filter((item) => !baselineSources.has(item.src));
    if (!fresh.length) return null;
    fresh.sort((a, b) => {
      const aGenerated = /generated|imagegen|dall|create/i.test(a.alt) ? 1 : 0;
      const bGenerated = /generated|imagegen|dall|create/i.test(b.alt) ? 1 : 0;
      if (aGenerated !== bGenerated) return bGenerated - aGenerated;
      return (b.width * b.height) - (a.width * a.height);
    });
    return fresh[0];
  }

  async saveImageSource(page, source, projectDir) {
    if (!source) throw new Error('Generated image source is empty.');
    let body;
    let contentType = '';

    if (/^(blob:|data:)/i.test(source)) {
      const encoded = await page.evaluate(async (src) => {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`);
        const type = response.headers.get('content-type') || '';
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return { base64: btoa(binary), type };
      }, source);
      body = Buffer.from(encoded.base64, 'base64');
      contentType = encoded.type;
    } else {
      const response = await page.context().request.get(source, { timeout: 45000 });
      if (!response.ok()) throw new Error(`Generated image request failed with ${response.status()}.`);
      contentType = response.headers()['content-type'] || '';
      body = await response.body();
    }

    if (!body || body.length < 10000) throw new Error('Captured generated image was unexpectedly small.');
    const ext = /webp/i.test(contentType) ? '.webp' : /jpe?g/i.test(contentType) ? '.jpg' : '.png';
    const savePath = path.join(projectDir, `generated${ext}`);
    fs.writeFileSync(savePath, body);
    return savePath;
  }

  async waitForGeneratedImage(page, projectId, baselineSources = new Set()) {
    const projectDir = this.projects.getProjectDir(projectId);
    const started = Date.now();
    const timeoutMs = 360000;

    while (Date.now() - started < timeoutMs) {
      await this.assertNoHumanGate(page);
      const image = await this.findNewGeneratedImage(page, baselineSources);
      if (image) {
        try {
          await wait(1800);
          const latest = await this.findNewGeneratedImage(page, baselineSources);
          const source = latest?.src || image.src;
          const savePath = await this.saveImageSource(page, source, projectDir);
          this.projects.update(projectId, {
            status: 'awaiting-review',
            generatedImagePath: savePath,
            automationStep: 'Ready for image review',
            chatgptError: null
          });
          return { ok: true, path: savePath, method: 'image-source' };
        } catch {
          // The image may still be transitioning from a preview URL. Keep polling,
          // then fall back to ChatGPT's download UI if source capture never succeeds.
        }
      }
      await wait(1800);
    }
    throw new Error('Timed out waiting for the completed ChatGPT image.');
  }

  async clickDownloadFallback(page, projectId) {
    const projectDir = this.projects.getProjectDir(projectId);
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => { page.off('download', handler); reject(new Error('ChatGPT download fallback timed out.')); }, 90000);
      const handler = async (download) => {
        try {
          clearTimeout(timeout);
          page.off('download', handler);
          const suggested = download.suggestedFilename() || 'generated-image.png';
          const ext = path.extname(suggested) || '.png';
          const savePath = path.join(projectDir, `generated${ext.toLowerCase()}`);
          await download.saveAs(savePath);
          resolve(savePath);
        } catch (error) { reject(error); }
      };
      page.on('download', handler);
      try {
        const clicked = await clickFirstVisible([
          page.getByRole('button', { name: /download|save image/i }).last(),
          page.getByRole('link', { name: /download|save image/i }).last(),
          page.locator('button[aria-label*="download" i]').last(),
          page.locator('button[title*="download" i]').last(),
          page.locator('[data-testid*="download" i]').last()
        ], { timeout: 8000 });
        if (!clicked) throw new Error('No ChatGPT download control was detected.');
      } catch (error) {
        clearTimeout(timeout);
        page.off('download', handler);
        reject(error);
      }
    });
  }

  async captureGeneratedImage(page, projectId, baselineSources) {
    this.projects.update(projectId, { status: 'generating', chatgptError: null, automationStep: 'Waiting for generated image' });
    try {
      return await this.waitForGeneratedImage(page, projectId, baselineSources);
    } catch (sourceError) {
      try {
        const savePath = await this.clickDownloadFallback(page, projectId);
        this.projects.update(projectId, { status: 'awaiting-review', generatedImagePath: savePath, automationStep: 'Ready for image review', chatgptError: null });
        return { ok: true, path: savePath, method: 'download-fallback' };
      } catch (downloadError) {
        const error = new Error(`ZeroPOD saw the ChatGPT generation finish but could not capture the image automatically. Source capture: ${sourceError.message} Download fallback: ${downloadError.message}`);
        this.projects.update(projectId, {
          status: 'chatgpt-recovery-needed',
          automationStep: 'Generated image capture needs attention',
          chatgptError: automationError('chatgpt', 'capture-generated-image', error, 'The generated image is already visible in ChatGPT. Use its normal Download/Save Image control once, then Retry if ZeroPOD still does not capture it.')
        });
        throw error;
      }
    }
  }

  async start({ referencePath, sourceUrl = '', reviewNotes = '', existingProjectId = null, onStep = null }) {
    if (!referencePath || !fs.existsSync(referencePath)) throw new Error('Reference image is missing.');
    const project = existingProjectId ? this.projects.read(existingProjectId) : this.projects.create({ referencePath, sourceUrl });
    const step = (message) => { if (typeof onStep === 'function') onStep(message); this.projects.update(project.id, { automationStep: message }); };
    try {
      step('Opening ChatGPT'); const { page } = await this.sessions.ensureService('chatgpt');
      step('Checking ChatGPT'); await this.assertNoHumanGate(page);
      step('Waiting for ChatGPT composer'); await this.ensureReady(page);
      step('Uploading reference image'); await this.attachReference(page, project.referencePath);
      const baselineSources = await this.snapshotImageSources(page);
      step('Sending generation prompt'); await this.submitPrompt(page, this.buildPrompt(sourceUrl || project.sourceUrl, reviewNotes));
      step('Waiting for generated image');
      this.captureGeneratedImage(page, project.id, baselineSources).catch(async (error) => {
        if (error.code === 'HUMAN_VERIFICATION_REQUIRED') await this.sessions.login('chatgpt').catch(() => {});
      });
      return { ok: true, projectId: project.id, status: 'generating', message: 'Generation submitted. ZeroPOD will capture the completed image directly from ChatGPT and move it to Review Queue.' };
    } catch (error) {
      const human = error.code === 'HUMAN_VERIFICATION_REQUIRED';
      if (human) await this.sessions.login('chatgpt').catch(() => {});
      const recovery = human ? { service: 'chatgpt', step: 'human-verification', message: error.message, recovery: 'Complete the human-verification challenge manually in the normal Edge window ZeroPOD opened, close it if it remains open, then retry. ZeroPOD does not automate or bypass verification.' } : automationError('chatgpt','generation',error,'Open ChatGPT from Connections, confirm you are signed in and the composer is usable, then retry the project.');
      this.projects.update(project.id, { status: 'chatgpt-recovery-needed', chatgptError: recovery, automationStep: human ? 'Human verification required' : 'Generation failed' });
      throw new Error(recovery.message);
    }
  }
}

module.exports = { ChatGPTController };
