const fs = require('fs');
const { retryStep, clickFirstVisible, fillFirstVisible } = require('./automationUtils');

class RedbubbleController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  async prepare(projectId) {
    const project = this.projects.read(projectId);
    if (!project.finalPngPath || !fs.existsSync(project.finalPngPath)) throw new Error('Final 4500×5400 PNG is missing. Export the project first.');
    if (!project.metadata) throw new Error('POD WINNER metadata is missing.');

    const { page } = await this.sessions.ensureService('redbubble');
    await page.bringToFront();
    if (!page.url().includes('redbubble.com')) await page.goto('https://www.redbubble.com/', { waitUntil: 'domcontentloaded' });

    this.projects.update(projectId, { status: 'redbubble-preparing', lastAutomationError: null });

    try {
      await retryStep('Open Copy Existing Work', async () => {
        const opened = await clickFirstVisible([
          page.getByRole('link', { name: /copy existing work/i }).first(),
          page.getByRole('button', { name: /copy existing work/i }).first(),
          page.getByText(/copy existing work/i, { exact: false }).first()
        ], { timeout: 7000 });
        if (opened) return true;
        const addNew = await clickFirstVisible([
          page.getByRole('link', { name: /add new work/i }).first(),
          page.getByRole('button', { name: /add new work/i }).first(),
          page.getByText(/add new work/i, { exact: false }).first()
        ], { timeout: 7000 });
        if (!addNew) throw new Error('Copy Existing Work entry point was not found.');
        await page.waitForTimeout(700);
        const copied = await clickFirstVisible([
          page.getByRole('link', { name: /copy existing work/i }).first(),
          page.getByRole('button', { name: /copy existing work/i }).first(),
          page.getByText(/copy existing work/i, { exact: false }).first()
        ], { timeout: 7000 });
        if (!copied) throw new Error('Copy Existing Work option did not appear.');
      }, { attempts: 2, delayMs: 1000 });

      await retryStep('Select first Redbubble work', async () => {
        const selected = await clickFirstVisible([
          page.locator('a[href*="copy"]').first(),
          page.locator('button').filter({ hasText: /copy/i }).first(),
          page.locator('[data-testid*="work"]').first(),
          page.locator('article').first(),
          page.locator('[role="listitem"]').first()
        ], { timeout: 7000 });
        if (!selected) throw new Error('Could not select the first work.');
      }, { attempts: 2, delayMs: 900 });

      await page.waitForTimeout(1000);
      await retryStep('Replace Redbubble artwork', async () => {
        let input = page.locator('input[type="file"]').first();
        if (!(await input.count())) {
          await clickFirstVisible([
            page.getByRole('button', { name: /replace|upload|change image|change artwork/i }).first(),
            page.getByText(/replace image|change image|upload new/i, { exact: false }).first()
          ], { timeout: 5000 });
          input = page.locator('input[type="file"]').first();
        }
        if (!(await input.count())) throw new Error('Main artwork upload control was not found.');
        await input.setInputFiles(project.finalPngPath);
      }, { attempts: 2, delayMs: 900 });

      const meta = project.metadata;
      const allTags = [meta.mainTag, ...(meta.supportingTags || [])].filter(Boolean).join(', ');
      await retryStep('Fill Redbubble listing fields', async () => {
        const title = await fillFirstVisible(page, ['input[name="title"]', 'input[id*="title"]', 'input[placeholder*="title" i]'], meta.title);
        const tags = await fillFirstVisible(page, ['textarea[name="tags"]', 'input[name="tags"]', 'textarea[id*="tag"]', 'input[id*="tag"]'], allTags);
        const description = await fillFirstVisible(page, ['textarea[name="description"]', 'textarea[id*="description"]', 'textarea[placeholder*="description" i]'], meta.description);
        if (!title || !tags || !description) throw new Error('One or more listing fields were not found.');
      }, { attempts: 2, delayMs: 900 });

      const updated = this.projects.update(projectId, {
        status: 'redbubble-review',
        lastAutomationError: null,
        redbubble: {
          ...(project.redbubble || {}),
          preparedAt: new Date().toISOString(), baseline: 'first-existing-work',
          title: meta.title, tags: allTags, description: meta.description,
          finalPngPath: project.finalPngPath, publishedAt: project.redbubble?.publishedAt || null
        }
      });
      return { ok: true, project: updated, message: 'Redbubble copy is prepared. Review inherited product settings, then use Publish / Save Work in ZeroPOD.' };
    } catch (error) {
      this.projects.update(projectId, { status: 'redbubble-recovery-needed', lastAutomationError: { service: 'Redbubble', message: error.message, at: new Date().toISOString(), recovery: 'Open Redbubble from Connections, verify login and Copy Existing Work, then retry Prepare Redbubble Copy.' } });
      throw error;
    }
  }

  async detectPublishSuccess(page, beforeUrl) {
    const successText = /successfully published|your work has been published|work published|published successfully/i;
    for (let i = 0; i < 30; i += 1) {
      const url = page.url();
      const body = await page.locator('body').innerText().catch(() => '');
      const publishStillVisible = await page.getByRole('button', { name: /save work|publish|submit/i }).last().isVisible().catch(() => false);
      const urlLooksFinal = url !== beforeUrl && /redbubble\.com\/(people|i|shop|portfolio|studio|manage|works?)/i.test(url) && !/add|edit|upload/i.test(url);
      if (successText.test(body) || urlLooksFinal || (!publishStillVisible && url !== beforeUrl)) return { verified: true, url };
      await page.waitForTimeout(1000);
    }
    return { verified: false, url: page.url() };
  }

  async publish(projectId) {
    const project = this.projects.read(projectId);
    if (!['redbubble-review', 'redbubble-publish-pending'].includes(project.status)) throw new Error('Prepare the Redbubble copy and review it before publishing.');

    const { page } = await this.sessions.ensureService('redbubble');
    await page.bringToFront();
    const beforeUrl = page.url();

    if (project.status === 'redbubble-review') {
      const clicked = await clickFirstVisible([
        page.getByRole('button', { name: /save work|publish|submit/i }).last(),
        page.getByRole('button', { name: /save changes/i }).last(),
        page.locator('button[type="submit"]').last()
      ], { timeout: 10000 });
      if (!clicked) throw new Error('Could not find the final Redbubble publish/save button.');
      this.projects.update(projectId, {
        status: 'redbubble-publish-pending',
        redbubble: { ...(project.redbubble || {}), publishAttemptedAt: new Date().toISOString(), publishAttemptUrl: beforeUrl }
      });
    }

    const result = await this.detectPublishSuccess(page, beforeUrl);
    if (!result.verified) {
      const pending = this.projects.update(projectId, {
        status: 'redbubble-publish-pending',
        lastAutomationError: {
          service: 'Redbubble', step: 'publish-verification',
          message: 'Publish was clicked, but ZeroPOD could not verify that Redbubble completed it.',
          at: new Date().toISOString(),
          recovery: 'Check the open Redbubble page. If the work is published, press Verify Publish in ZeroPOD. Do not submit the form a second time unless Redbubble clearly shows it was not published.'
        },
        redbubble: { ...(this.projects.read(projectId).redbubble || {}), lastVerificationUrl: result.url }
      });
      return { ok: false, pending: true, project: pending, message: 'Publish is pending verification. Check Redbubble, then use Verify Publish.' };
    }

    const current = this.projects.read(projectId);
    const updated = this.projects.update(projectId, {
      status: 'published', lastAutomationError: null,
      redbubble: { ...(current.redbubble || {}), publishedAt: new Date().toISOString(), publishedUrl: result.url, lastVerificationUrl: result.url }
    });
    return { ok: true, verified: true, project: updated, publishedUrl: result.url };
  }
}

module.exports = { RedbubbleController };
