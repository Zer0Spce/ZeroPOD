const fs = require('fs');
const { retryStep, clickFirstVisible, fillFirstVisible } = require('./automationUtils');

const REDBUBBLE_NEW_WORK_URL = 'https://www.redbubble.com/portfolio/images/new?ref=dashboard';

class RedbubbleController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  async isVisible(locator) {
    if (!(await locator.count().catch(() => 0))) return false;
    return locator.isVisible().catch(() => false);
  }

  async waitForEditor(page, timeoutMs = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const hasFile = await page.locator('input[type="file"]').count().catch(() => 0);
      const hasTitle = await page.locator('input[name="title"], input[id*="title" i], input[placeholder*="title" i]').count().catch(() => 0);
      const body = await page.locator('body').innerText().catch(() => '');
      if (hasFile || hasTitle || /title\s*tags\s*description/i.test(body)) return true;
      await page.waitForTimeout(300);
    }
    return false;
  }

  async openCopyExisting(page) {
    if (!page.url().startsWith('https://www.redbubble.com/portfolio/images/new')) {
      await page.goto(REDBUBBLE_NEW_WORK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } else {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    if (/redbubble\.com\/auth\/login/i.test(page.url())) {
      throw new Error('Redbubble login is required. Open Redbubble from Connections, sign in, then retry.');
    }

    const opened = await clickFirstVisible([
      page.getByRole('button', { name: /copy (?:an |your )?existing work/i }).first(),
      page.getByRole('link', { name: /copy (?:an |your )?existing work/i }).first(),
      page.getByRole('button', { name: /copy settings from existing work/i }).first(),
      page.getByRole('link', { name: /copy settings from existing work/i }).first(),
      page.getByText(/copy (?:an |your )?existing work/i, { exact: false }).first(),
      page.getByText(/copy settings from existing work/i, { exact: false }).first()
    ], { timeout: 15000 });

    if (!opened) {
      const body = await page.locator('body').innerText().catch(() => '');
      if (!/copy/i.test(body)) {
        throw new Error('Redbubble Add New Work opened, but the Copy Existing Work option was not found.');
      }
    }

    await page.waitForTimeout(800);
  }

  async clickCopyAction(page) {
    const action = await clickFirstVisible([
      page.getByRole('button', { name: /copy and replace all images/i }).first(),
      page.getByRole('link', { name: /copy and replace all images/i }).first(),
      page.getByRole('button', { name: /copy settings/i }).first(),
      page.getByRole('link', { name: /copy settings/i }).first(),
      page.getByRole('button', { name: /^copy$/i }).first(),
      page.getByRole('link', { name: /^copy$/i }).first()
    ], { timeout: 2500 }).catch(() => false);
    return Boolean(action);
  }

  async selectFirstExistingWork(page) {
    // Some Redbubble layouts expose a Copy action directly beside each work.
    if (await this.clickCopyAction(page)) {
      if (await this.waitForEditor(page, 12000)) return true;
    }

    const cardSelectors = [
      '[data-testid*="work" i]',
      '[data-testid*="portfolio" i]',
      'article',
      '[role="listitem"]'
    ];

    for (const selector of cardSelectors) {
      const cards = page.locator(selector);
      const count = Math.min(await cards.count().catch(() => 0), 8);
      for (let index = 0; index < count; index += 1) {
        const card = cards.nth(index);
        if (!(await this.isVisible(card))) continue;
        const hasImage = (await card.locator('img').count().catch(() => 0)) > 0;
        const text = await card.innerText().catch(() => '');
        if (!hasImage && !text.trim()) continue;

        const copiedInCard = await clickFirstVisible([
          card.getByRole('button', { name: /copy and replace all images|copy settings|^copy$/i }).first(),
          card.getByRole('link', { name: /copy and replace all images|copy settings|^copy$/i }).first(),
          card.getByText(/copy and replace all images|copy settings/i, { exact: false }).first()
        ], { timeout: 1200 }).catch(() => false);
        if (copiedInCard && await this.waitForEditor(page, 12000)) return true;

        // Current Redbubble can hide Copy behind the first work's cog / overflow menu.
        const menuOpened = await clickFirstVisible([
          card.getByRole('button', { name: /more|menu|options|actions|settings/i }).first(),
          card.locator('button[aria-haspopup="menu"]').first(),
          card.locator('button[title*="more" i], button[title*="option" i], button[aria-label*="more" i], button[aria-label*="option" i]').first()
        ], { timeout: 1200 }).catch(() => false);

        if (menuOpened) {
          await page.waitForTimeout(250);
          if (await this.clickCopyAction(page)) {
            if (await this.waitForEditor(page, 12000)) return true;
          }
        }

        // Last card-level fallback: open the first work, then use its Copy action.
        await card.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        if (await this.clickCopyAction(page)) {
          if (await this.waitForEditor(page, 12000)) return true;
        }
      }
    }

    // Fallback for layouts where works are plain portfolio links instead of cards.
    const workLinks = page.locator('a[href*="/portfolio/images/"]:not([href*="/new"])');
    const linkCount = Math.min(await workLinks.count().catch(() => 0), 6);
    for (let index = 0; index < linkCount; index += 1) {
      const link = workLinks.nth(index);
      if (!(await this.isVisible(link))) continue;
      await link.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      if (await this.clickCopyAction(page)) {
        if (await this.waitForEditor(page, 12000)) return true;
      }
    }

    const visibleActions = await page.locator('button, a').evaluateAll((elements) => elements
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
      .slice(0, 30)).catch(() => []);

    throw new Error(`Could not copy the first existing Redbubble work. Visible actions: ${visibleActions.join(' | ').slice(0, 800)}`);
  }

  async prepare(projectId) {
    const project = this.projects.read(projectId);
    if (!project.finalPngPath || !fs.existsSync(project.finalPngPath)) throw new Error('Final 4500×5400 PNG is missing. Export the project first.');
    if (!project.metadata) throw new Error('POD WINNER metadata is missing.');

    const { page } = await this.sessions.ensureService('redbubble');
    await page.bringToFront();

    this.projects.update(projectId, { status: 'redbubble-preparing', lastAutomationError: null });

    try {
      await retryStep('Open Redbubble Copy Existing Work', async () => {
        await this.openCopyExisting(page);
      }, { attempts: 2, delayMs: 900 });

      await retryStep('Copy first Redbubble work', async () => {
        const ready = await this.waitForEditor(page, 800);
        if (!ready) await this.selectFirstExistingWork(page);
      }, { attempts: 2, delayMs: 800 });

      await page.waitForTimeout(700);
      await retryStep('Replace Redbubble artwork', async () => {
        let input = page.locator('input[type="file"]').first();
        if (!(await input.count())) {
          await clickFirstVisible([
            page.getByRole('button', { name: /replace|upload|change image|change artwork/i }).first(),
            page.getByText(/replace image|change image|upload new|replace all images/i, { exact: false }).first()
          ], { timeout: 7000 });
          await page.waitForTimeout(300);
          input = page.locator('input[type="file"]').first();
        }
        if (!(await input.count())) throw new Error('Main artwork upload control was not found after copying the baseline work.');
        await input.setInputFiles(project.finalPngPath);
      }, { attempts: 2, delayMs: 900 });

      const meta = project.metadata;
      const allTags = [meta.mainTag, ...(meta.supportingTags || [])].filter(Boolean).join(', ');
      await retryStep('Fill Redbubble listing fields', async () => {
        const title = await fillFirstVisible(page, ['input[name="title"]', 'input[id*="title"]', 'input[placeholder*="title" i]'], meta.title);
        const tags = await fillFirstVisible(page, ['textarea[name="tags"]', 'input[name="tags"]', 'textarea[id*="tag"]', 'input[id*="tag"]'], allTags);
        const description = await fillFirstVisible(page, ['textarea[name="description"]', 'textarea[id*="description"]', 'textarea[placeholder*="description" i]'], meta.description);
        if (!title || !tags || !description) throw new Error('One or more Redbubble listing fields were not found.');
      }, { attempts: 2, delayMs: 900 });

      const updated = this.projects.update(projectId, {
        status: 'redbubble-review',
        lastAutomationError: null,
        redbubble: {
          ...(project.redbubble || {}),
          preparedAt: new Date().toISOString(),
          baseline: 'first-existing-work',
          title: meta.title,
          tags: allTags,
          description: meta.description,
          finalPngPath: project.finalPngPath,
          publishedAt: project.redbubble?.publishedAt || null
        }
      });
      return { ok: true, project: updated, message: 'Redbubble copy is prepared. Review inherited product settings, then use Publish / Save Work in ZeroPOD.' };
    } catch (error) {
      this.projects.update(projectId, {
        status: 'redbubble-recovery-needed',
        lastAutomationError: {
          service: 'Redbubble',
          message: error.message,
          at: new Date().toISOString(),
          recovery: `Keep Redbubble signed in, open ${REDBUBBLE_NEW_WORK_URL}, then retry Prepare Redbubble Copy. ZeroPOD will choose Copy Existing Work and use the first existing work as the baseline.`
        }
      });
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
