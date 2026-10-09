const fs = require('fs');
const path = require('path');
const { retryStep, clickFirstVisible, automationError } = require('./automationUtils');

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

  async waitForGeneratedDownload(page, projectId) {
    const project = this.projects.read(projectId); const projectDir = this.projects.getProjectDir(projectId);
    const downloadPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => { if (settled) return; settled = true; page.off('download', handler); resolve(result); };
      const handler = async (download) => { try { const suggested = download.suggestedFilename() || 'generated-image.png'; const ext = path.extname(suggested) || '.png'; const savePath = path.join(projectDir, `generated${ext.toLowerCase()}`); await download.saveAs(savePath); this.projects.update(projectId, { status: 'awaiting-review', generatedImagePath: savePath, chatgptError: null }); finish({ ok: true, path: savePath }); } catch (error) { finish({ ok: false, error: error.message }); } };
      page.on('download', handler);
      setTimeout(() => { if (!settled) { this.projects.update(projectId, { status: 'chatgpt-recovery-needed', chatgptError: { step: 'download', message: 'ZeroPOD could not detect the generated image download automatically.', recovery: 'Keep ChatGPT open, click the generated image Download button manually, then return to ZeroPOD.' } }); finish({ ok: false, error: 'Automatic ChatGPT image download timed out.' }); } }, 360000);
    });
    this.projects.update(project.id, { status: 'generating', chatgptError: null });
    (async () => { try { await retryStep('Find ChatGPT generated image download', async () => { await this.assertNoHumanGate(page); const clicked = await clickFirstVisible([page.getByRole('button', { name: /download/i }).last(),page.getByRole('link', { name: /download/i }).last(),page.locator('button[aria-label*="download" i]').last(),page.locator('[data-testid*="download" i]').last()], { timeout: 90000 }); if (!clicked) throw new Error('Generated image download control is not visible yet.'); return true; }, { attempts: 3, delayMs: 2500 }); } catch (error) { const human = error.code === 'HUMAN_VERIFICATION_REQUIRED'; if (human) await this.sessions.login('chatgpt').catch(() => {}); this.projects.update(projectId, { status: 'chatgpt-recovery-needed', automationStep: human ? 'Human verification required' : 'Download needs attention', chatgptError: human ? { service: 'chatgpt', step: 'human-verification', message: error.message, recovery: 'Complete the challenge manually in the normal Edge window that ZeroPOD opened, close it if it remains open, then Retry the queue row.' } : automationError('chatgpt','download',error,'The generated image may still be ready in ChatGPT. Click its Download control manually; ZeroPOD will capture the browser download if the session is still open.') }); } })();
    return downloadPromise;
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
      step('Sending generation prompt'); await this.submitPrompt(page, this.buildPrompt(sourceUrl || project.sourceUrl, reviewNotes));
      step('Waiting for generated image'); this.waitForGeneratedDownload(page, project.id).catch(() => {});
      return { ok: true, projectId: project.id, status: 'generating', message: 'Generation submitted.' };
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
