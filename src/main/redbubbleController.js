const fs = require('fs');
const { retryStep, clickFirstVisible, fillFirstVisible } = require('./automationUtils');

const REDBUBBLE_MANAGE_WORKS_URL = 'https://www.redbubble.com/portfolio/manage_works?ref=duplicate_work';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RedbubbleController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  async isVisible(locator) {
    if (!(await locator.count().catch(() => 0))) return false;
    return locator.isVisible().catch(() => false);
  }

  async waitForEditor(page, timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const replace = page.getByRole('button', { name: /replace all images/i }).first();
      const titleCount = await page.locator('input[name="title"], input[id*="title" i], input[placeholder*="title" i]').count().catch(() => 0);
      const body = await page.locator('body').innerText().catch(() => '');
      if (await replace.isVisible().catch(() => false)) return true;
      if (titleCount && /main tag/i.test(body) && /supporting tags/i.test(body)) return true;
      await page.waitForTimeout(300);
    }
    return false;
  }

  async openManageWorks(page) {
    await page.goto(REDBUBBLE_MANAGE_WORKS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    if (/redbubble\.com\/auth\/login/i.test(page.url())) {
      throw new Error('Redbubble login is required. Open Redbubble from Connections, sign in, then retry.');
    }

    const body = await page.locator('body').innerText().catch(() => '');
    if (!/manage portfolio|search your works|works/i.test(body)) {
      throw new Error('Redbubble Manage Works did not load correctly.');
    }
  }

  async clickFirstSettingsGear(page) {
    // Prefer accessible settings/action controls when Redbubble exposes a label.
    const semantic = await clickFirstVisible([
      page.getByRole('button', { name: /settings|actions|options|more/i }).first(),
      page.locator('button[aria-label*="settings" i], button[title*="settings" i]').first(),
      page.locator('[role="button"][aria-label*="settings" i], [role="button"][title*="settings" i]').first()
    ], { timeout: 2500 }).catch(() => false);
    if (semantic) return true;

    // Current Manage Works shows a small circular gear in the top-right corner of
    // every artwork card. Pick the first small visible action control in the work grid.
    const box = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, [role="button"]'));
      const candidates = elements.map((el) => {
        const r = el.getBoundingClientRect();
        const text = String(el.innerText || el.textContent || '').trim();
        const label = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
        const style = window.getComputedStyle(el);
        return { el, r, text, label, style };
      }).filter(({ r, style }) => r.width >= 20 && r.width <= 76
        && r.height >= 20 && r.height <= 76
        && r.top > 300
        && r.left > 0
        && r.bottom < window.innerHeight + window.scrollY + 300
        && style.visibility !== 'hidden'
        && style.display !== 'none');

      candidates.sort((a, b) => {
        const aNamed = /settings|actions|options|more/i.test(a.label) ? 0 : 1;
        const bNamed = /settings|actions|options|more/i.test(b.label) ? 0 : 1;
        if (aNamed !== bNamed) return aNamed - bNamed;
        if (Math.abs(a.r.top - b.r.top) > 12) return a.r.top - b.r.top;
        return a.r.left - b.r.left;
      });

      const chosen = candidates[0];
      if (!chosen) return null;
      return {
        x: chosen.r.left + chosen.r.width / 2,
        y: chosen.r.top + chosen.r.height / 2,
        label: chosen.label || chosen.text
      };
    }).catch(() => null);

    if (!box) throw new Error('The first Redbubble work settings circle was not found.');
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(300);
    return true;
  }

  async openFirstCopySettings(page) {
    await this.clickFirstSettingsGear(page);

    const clicked = await clickFirstVisible([
      page.getByRole('link', { name: /^copy settings$/i }).first(),
      page.getByRole('button', { name: /^copy settings$/i }).first(),
      page.getByText(/^copy settings$/i, { exact: true }).first(),
      page.locator('a[href*="/duplicate"]').first()
    ], { timeout: 7000 }).catch(() => false);

    if (!clicked) {
      const actions = await page.locator('a, button, [role="menuitem"]').evaluateAll((els) => els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el) => String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
        .filter(Boolean)
        .slice(0, 40)).catch(() => []);
      throw new Error(`Copy settings was not found after opening the first work settings menu. Visible actions: ${actions.join(' | ').slice(0, 800)}`);
    }

    if (!(await this.waitForEditor(page, 25000))) {
      throw new Error('Redbubble Copy settings opened, but the copied-work editor did not become ready.');
    }
  }

  async waitForArtworkUpload(page, timeoutMs = 120000) {
    const started = Date.now();
    let sawBusy = false;

    while (Date.now() - started < timeoutMs) {
      const busyCount = await page.locator('[role="progressbar"], [aria-busy="true"]').count().catch(() => 0);
      const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
      const textBusy = /uploading|processing image|replacing image|please wait|preparing image/.test(body);
      if (busyCount || textBusy) sawBusy = true;

      const replace = page.getByRole('button', { name: /replace all images/i }).first();
      const replaceReady = await replace.isVisible().catch(() => false)
        && await replace.isEnabled().catch(() => true);

      if (!busyCount && !textBusy && replaceReady && (sawBusy || Date.now() - started > 3500)) return true;
      await page.waitForTimeout(400);
    }

    throw new Error('Redbubble did not finish loading the replacement artwork before timeout.');
  }

  async replaceAllImages(page, imagePath) {
    const replaceButton = page.getByRole('button', { name: /replace all images/i }).first();
    if (!(await replaceButton.isVisible().catch(() => false))) {
      throw new Error('Redbubble Replace all images button was not found in the copied-work editor.');
    }

    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await replaceButton.click({ force: true });
    const chooser = await chooserPromise;

    if (chooser) {
      await chooser.setFiles(imagePath);
    } else {
      await page.waitForTimeout(300);
      const fileInputs = page.locator('input[type="file"]');
      const count = await fileInputs.count().catch(() => 0);
      if (!count) throw new Error('Replace all images did not expose a file upload control.');
      await fileInputs.last().setInputFiles(imagePath);
    }

    await this.waitForArtworkUpload(page);
  }

  async fieldScopeFromLabel(page, labelRegex) {
    const label = page.getByText(labelRegex, { exact: true }).first();
    if (!(await label.isVisible().catch(() => false))) return null;

    const scope = label.locator('xpath=ancestor::*[.//input or .//textarea or .//*[@contenteditable="true"]][1]');
    if (await scope.count().catch(() => 0)) return scope;
    return null;
  }

  async clearTagChips(scope) {
    if (!scope) return;
    for (let pass = 0; pass < 24; pass += 1) {
      const remove = scope.locator('button[aria-label*="remove" i], button[aria-label*="delete" i], button[title*="remove" i], button[title*="delete" i]').first();
      if (await remove.isVisible().catch(() => false)) {
        await remove.click({ force: true }).catch(() => {});
        await wait(80);
        continue;
      }

      const xButton = scope.locator('button').filter({ hasText: /^\s*[×x]\s*$/i }).first();
      if (await xButton.isVisible().catch(() => false)) {
        await xButton.click({ force: true }).catch(() => {});
        await wait(80);
        continue;
      }
      break;
    }
  }

  async tagInputFromScope(scope) {
    if (!scope) return null;
    const input = scope.locator('input:not([type="hidden"]), textarea, [contenteditable="true"]').last();
    if (!(await input.count().catch(() => 0))) return null;
    return input;
  }

  async replaceChipTags(page, labelRegex, tags) {
    const scope = await this.fieldScopeFromLabel(page, labelRegex);
    if (!scope) return false;
    await this.clearTagChips(scope);
    const input = await this.tagInputFromScope(scope);
    if (!input) return false;

    for (const tag of tags.filter(Boolean)) {
      await input.click({ force: true }).catch(() => {});
      await input.fill(String(tag)).catch(async () => {
        await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
        await input.type(String(tag));
      });
      await input.press('Enter');
      await page.waitForTimeout(100);
    }
    return true;
  }

  async fillListingFields(page, metadata) {
    const title = await fillFirstVisible(page, [
      'input[name="title"]',
      'input[id*="title" i]',
      'input[placeholder*="title" i]'
    ], metadata.title);
    if (!title) throw new Error('Redbubble Title field was not found.');

    const mainTagDone = await this.replaceChipTags(page, /^main tag$/i, [metadata.mainTag]);
    const supporting = Array.isArray(metadata.supportingTags) ? metadata.supportingTags.slice(0, 14) : [];
    const supportingDone = await this.replaceChipTags(page, /^supporting tags$/i, supporting);

    // Fallback for older Redbubble layouts that still expose one combined tags field.
    if (!mainTagDone || !supportingDone) {
      const combined = [metadata.mainTag, ...supporting].filter(Boolean).join(', ');
      const tagsDone = await fillFirstVisible(page, [
        'textarea[name="tags"]',
        'input[name="tags"]',
        'textarea[id*="tag" i]',
        'input[id*="tag" i]'
      ], combined);
      if (!tagsDone && (!mainTagDone || !supportingDone)) {
        throw new Error('Redbubble Main Tag / Supporting Tags fields were not found.');
      }
    }

    const description = await fillFirstVisible(page, [
      'textarea[name="description"]',
      'textarea[id*="description" i]',
      'textarea[placeholder*="description" i]'
    ], metadata.description);
    if (!description) throw new Error('Redbubble Description field was not found.');
  }

  async prepare(projectId) {
    const project = this.projects.read(projectId);
    if (!project.finalPngPath || !fs.existsSync(project.finalPngPath)) throw new Error('Final 4500×5400 PNG is missing. Export the project first.');
    if (!project.metadata) throw new Error('POD WINNER metadata is missing.');

    const { page } = await this.sessions.ensureService('redbubble');
    await page.bringToFront();
    this.projects.update(projectId, { status: 'redbubble-preparing', lastAutomationError: null });

    try {
      await retryStep('Open Redbubble Manage Works', async () => {
        await this.openManageWorks(page);
      }, { attempts: 2, delayMs: 800 });

      await retryStep('Copy settings from first work', async () => {
        await this.openFirstCopySettings(page);
      }, { attempts: 2, delayMs: 800 });

      await retryStep('Replace all Redbubble images', async () => {
        await this.replaceAllImages(page, project.finalPngPath);
      }, { attempts: 2, delayMs: 900 });

      await retryStep('Fill Redbubble listing metadata', async () => {
        await this.fillListingFields(page, project.metadata);
      }, { attempts: 2, delayMs: 900 });

      const meta = project.metadata;
      const allTags = [meta.mainTag, ...(meta.supportingTags || [])].filter(Boolean).join(', ');
      const updated = this.projects.update(projectId, {
        status: 'redbubble-review',
        lastAutomationError: null,
        redbubble: {
          ...(project.redbubble || {}),
          preparedAt: new Date().toISOString(),
          baseline: 'first-existing-work-copy-settings',
          title: meta.title,
          tags: allTags,
          description: meta.description,
          finalPngPath: project.finalPngPath,
          publishedAt: project.redbubble?.publishedAt || null
        }
      });

      return {
        ok: true,
        project: updated,
        message: 'Redbubble copy is prepared. Review inherited placement/product settings, then Publish / Save Work from ZeroPOD.'
      };
    } catch (error) {
      this.projects.update(projectId, {
        status: 'redbubble-recovery-needed',
        lastAutomationError: {
          service: 'Redbubble',
          message: error.message,
          at: new Date().toISOString(),
          recovery: `Keep Redbubble signed in and open ${REDBUBBLE_MANAGE_WORKS_URL}. Retry Prepare Redbubble Copy. ZeroPOD will use the first settings circle -> Copy settings -> Replace all images -> metadata flow.`
        }
      });
      throw error;
    }
  }

  async ensureAgreementChecked(page) {
    const labelled = page.getByRole('checkbox', { name: /i agree to the redbubble user agreement/i }).first();
    if (await labelled.count().catch(() => 0)) {
      if (!(await labelled.isChecked().catch(() => false))) await labelled.check({ force: true });
      return true;
    }

    const text = page.getByText(/i agree to the redbubble user agreement/i, { exact: false }).last();
    if (await text.isVisible().catch(() => false)) {
      const scope = text.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]');
      const checkbox = scope.locator('input[type="checkbox"]').first();
      if (await checkbox.count().catch(() => 0)) {
        if (!(await checkbox.isChecked().catch(() => false))) await checkbox.check({ force: true });
        return true;
      }
    }

    const lastCheckbox = page.locator('input[type="checkbox"]').last();
    if (await lastCheckbox.count().catch(() => 0)) {
      if (!(await lastCheckbox.isChecked().catch(() => false))) await lastCheckbox.check({ force: true });
      return true;
    }

    throw new Error('Redbubble agreement checkbox was not found.');
  }

  async detectPublishSuccess(page, beforeUrl) {
    const successText = /successfully published|your work has been published|work published|published successfully|work saved|saved successfully/i;
    for (let i = 0; i < 45; i += 1) {
      const url = page.url();
      const body = await page.locator('body').innerText().catch(() => '');
      const saveStillVisible = await page.getByRole('button', { name: /save work|publish|submit/i }).last().isVisible().catch(() => false);
      const urlLooksFinal = url !== beforeUrl
        && /redbubble\.com\/(people|i|shop|portfolio|studio|manage|works?)/i.test(url)
        && !/duplicate|edit|upload/i.test(url);
      if (successText.test(body) || urlLooksFinal || (!saveStillVisible && url !== beforeUrl)) return { verified: true, url };
      await page.waitForTimeout(1000);
    }
    return { verified: false, url: page.url() };
  }

  async publish(projectId) {
    const project = this.projects.read(projectId);
    if (!['redbubble-review', 'redbubble-publish-pending'].includes(project.status)) {
      throw new Error('Prepare the Redbubble copy and review it before publishing.');
    }

    const { page } = await this.sessions.ensureService('redbubble');
    await page.bringToFront();
    const beforeUrl = page.url();

    if (project.status === 'redbubble-review') {
      await this.ensureAgreementChecked(page);
      await page.waitForTimeout(250);

      const clicked = await clickFirstVisible([
        page.getByRole('button', { name: /^save work$/i }).last(),
        page.getByRole('button', { name: /save work|publish|submit/i }).last(),
        page.locator('button[type="submit"]').last()
      ], { timeout: 12000 });
      if (!clicked) throw new Error('Could not find the Redbubble Save work button after checking the agreement box.');

      this.projects.update(projectId, {
        status: 'redbubble-publish-pending',
        redbubble: {
          ...(project.redbubble || {}),
          publishAttemptedAt: new Date().toISOString(),
          publishAttemptUrl: beforeUrl
        }
      });
    }

    const result = await this.detectPublishSuccess(page, beforeUrl);
    if (!result.verified) {
      const pending = this.projects.update(projectId, {
        status: 'redbubble-publish-pending',
        lastAutomationError: {
          service: 'Redbubble',
          step: 'publish-verification',
          message: 'Save work was clicked, but ZeroPOD could not verify that Redbubble completed it.',
          at: new Date().toISOString(),
          recovery: 'Check the open Redbubble page. If the work is saved/published, press Verify Publish in ZeroPOD. Do not click Save work again unless Redbubble clearly shows the save failed.'
        },
        redbubble: {
          ...(this.projects.read(projectId).redbubble || {}),
          lastVerificationUrl: result.url
        }
      });
      return { ok: false, pending: true, project: pending, message: 'Redbubble save is pending verification.' };
    }

    const current = this.projects.read(projectId);
    const updated = this.projects.update(projectId, {
      status: 'published',
      lastAutomationError: null,
      redbubble: {
        ...(current.redbubble || {}),
        publishedAt: new Date().toISOString(),
        publishedUrl: result.url,
        lastVerificationUrl: result.url
      }
    });
    return { ok: true, verified: true, project: updated, publishedUrl: result.url };
  }
}

module.exports = { RedbubbleController, REDBUBBLE_MANAGE_WORKS_URL };
