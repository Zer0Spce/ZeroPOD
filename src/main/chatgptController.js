const fs = require('fs');
const path = require('path');

class ChatGPTController {
  constructor({ sessions, projects, podRules }) {
    this.sessions = sessions;
    this.projects = projects;
    this.podRules = podRules;
  }

  buildPrompt(sourceUrl = '', reviewNotes = '') {
    const rules = this.podRules.map((rule) => `- ${rule}`).join('\n');
    return [
      'Create a new Print-On-Demand design using the attached reference image.',
      'Copy the slogan exactly from the reference, but create a fresh visual style instead of cloning the original artwork.',
      sourceUrl ? `Source/reference URL for niche context only: ${sourceUrl}` : '',
      '',
      'Permanent ZeroPOD rules:',
      rules,
      '',
      reviewNotes ? `Revision notes from the previous review:\n${reviewNotes}` : '',
      '',
      'Generate the image only for this step. Do not generate listing metadata yet. We will review the image first.'
    ].filter(Boolean).join('\n');
  }

  async locateComposer(page) {
    const selectors = [
      '#prompt-textarea',
      'textarea[placeholder*="Message"]',
      'textarea',
      '[contenteditable="true"][data-placeholder]',
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) return locator;
    }
    throw new Error('Could not find the ChatGPT message composer. The website UI may have changed.');
  }

  async attachReference(page, referencePath) {
    let input = page.locator('input[type="file"]').first();
    if (!(await input.count())) {
      const attachButton = page.getByRole('button', { name: /attach|upload|add/i }).first();
      if (await attachButton.count()) {
        await attachButton.click();
        await page.waitForTimeout(500);
        input = page.locator('input[type="file"]').first();
      }
    }

    if (!(await input.count())) {
      throw new Error('Could not find ChatGPT image upload input.');
    }

    await input.setInputFiles(referencePath);
    await page.waitForTimeout(1200);
  }

  async submitPrompt(page, prompt) {
    const composer = await this.locateComposer(page);
    await composer.click();

    const tagName = await composer.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'textarea' || tagName === 'input') {
      await composer.fill(prompt);
    } else {
      await composer.fill(prompt).catch(async () => {
        await composer.pressSequentially(prompt, { delay: 1 });
      });
    }

    const sendButton = page.locator('button[data-testid="send-button"]').first();
    if (await sendButton.count()) {
      await sendButton.click();
    } else {
      await composer.press('Enter');
    }
  }

  async waitForGeneratedDownload(page, projectId) {
    const project = this.projects.read(projectId);
    const projectDir = this.projects.getProjectDir(projectId);

    const downloadPromise = new Promise((resolve) => {
      const handler = async (download) => {
        try {
          const suggested = download.suggestedFilename() || 'generated-image.png';
          const ext = path.extname(suggested) || '.png';
          const savePath = path.join(projectDir, `generated${ext.toLowerCase()}`);
          await download.saveAs(savePath);
          page.off('download', handler);
          this.projects.update(projectId, {
            status: 'awaiting-review',
            generatedImagePath: savePath
          });
          resolve({ ok: true, path: savePath });
        } catch (error) {
          resolve({ ok: false, error: error.message });
        }
      };
      page.on('download', handler);
    });

    this.projects.update(project.id, { status: 'generating' });

    const autoClick = (async () => {
      try {
        const downloadButton = page.getByRole('button', { name: /download/i }).last();
        await downloadButton.waitFor({ state: 'visible', timeout: 300000 });
        await downloadButton.click();
      } catch {
        // Fallback: user can click the visible Download control in ChatGPT manually.
      }
    })();

    await autoClick;
    return downloadPromise;
  }

  async start({ referencePath, sourceUrl = '', reviewNotes = '', existingProjectId = null }) {
    if (!referencePath || !fs.existsSync(referencePath)) {
      throw new Error('Reference image is missing.');
    }

    const project = existingProjectId
      ? this.projects.read(existingProjectId)
      : this.projects.create({ referencePath, sourceUrl });

    const { context, page } = await this.sessions.ensureService('chatgpt');
    await page.bringToFront();
    if (!page.url().startsWith('https://chatgpt.com')) {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    }

    await this.attachReference(page, project.referencePath);
    await this.submitPrompt(page, this.buildPrompt(sourceUrl || project.sourceUrl, reviewNotes));

    this.waitForGeneratedDownload(page, project.id).catch(() => {});

    return {
      ok: true,
      projectId: project.id,
      status: 'generating',
      message: 'Generation submitted. ZeroPOD will capture the ChatGPT download automatically when available. If auto-download is unavailable, click Download in ChatGPT and ZeroPOD will still save it.'
    };
  }
}

module.exports = { ChatGPTController };
