const fs = require('fs');
const path = require('path');
const { feature } = require('./spreadshirtAlphaIpc');
const {
  MARKETPLACE_DESIGNS_URL,
  waitForMarketplaceDesigns
} = require('./spreadshirtMarketplaceRoutePatch');
const {
  openCreateNewDialog,
  selectFileLikeVideo,
  waitForUploadResult,
  clickUploadedDesign,
  waitForDesignEditor,
  waitForProductsCreated,
  enableSpreadshirtMarketplace
} = require('./spreadshirtVideoFlowPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HUMAN_CHECK_PATTERN = /captcha|verify you are human|are you human|cloudflare/i;

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function designTitleFromFile(file) {
  return path.basename(String(file || ''), path.extname(String(file || ''))).trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function visibleExactTitleLocators(page, title) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(title)}\\s*$`, 'i');
  const locator = page.getByText(pattern).filter({ visible: true });
  const count = await locator.count().catch(() => 0);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) result.push(item);
  }
  return result;
}

async function countVisibleDesignTitles(page, title) {
  return (await visibleExactTitleLocators(page, title)).length;
}

async function clickDesignTitle(page, title) {
  const matches = await visibleExactTitleLocators(page, title);
  for (const titleNode of matches) {
    const beforeUrl = page.url();
    try {
      await titleNode.scrollIntoViewIfNeeded().catch(() => {});
      await titleNode.click({ force: true, timeout: 3000 });
      await wait(600);
      if (page.url() !== beforeUrl) return true;
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Design products|Publish on Spreadshirt|Metadata/i.test(text)) return true;
    } catch {}

    try {
      const clicked = await titleNode.evaluate((el) => {
        const candidate = el.closest('a,button,[role="button"],[tabindex],article,li,[class*="card" i],[class*="design" i]') || el.parentElement;
        if (!candidate) return false;
        candidate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      });
      if (clicked) {
        await wait(700);
        if (page.url() !== beforeUrl) return true;
        const text = await page.locator('body').innerText().catch(() => '');
        if (/Design products|Publish on Spreadshirt|Metadata/i.test(text)) return true;
      }
    } catch {}
  }
  return false;
}

async function openUploadedDraftByTitle(page, title, options = {}) {
  const timeoutMs = options.timeoutMs || 45000;
  const minimumVisibleCount = Math.max(1, Number(options.minimumVisibleCount) || 1);
  const allowAnyExisting = Boolean(options.allowAnyExisting);
  const started = Date.now();
  let lastReloadAt = 0;
  let lastCount = 0;

  while (Date.now() - started < timeoutMs) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (HUMAN_CHECK_PATTERN.test(body)) {
      throw new Error('Spreadshirt is showing a human-verification challenge. Complete it manually, then retry.');
    }

    lastCount = await countVisibleDesignTitles(page, title);
    const enough = lastCount >= minimumVisibleCount || (allowAnyExisting && lastCount > 0);
    if (enough && await clickDesignTitle(page, title)) {
      return { ok: true, title, visibleCount: lastCount, method: 'exact-title' };
    }

    if (Date.now() - lastReloadAt > 6000) {
      lastReloadAt = Date.now();
      if (!/\/mp\/designs(?:[/?#]|$)/i.test(page.url())) {
        await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      } else {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      }
      await waitForMarketplaceDesigns(page, 12000).catch(() => {});
    }
    await wait(500);
  }

  return { ok: false, title, visibleCount: lastCount, method: 'exact-title' };
}

async function returnToMarketplaceDesigns(page) {
  if (!/\/mp\/designs(?:[/?#]|$)/i.test(page.url())) {
    await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await waitForMarketplaceDesigns(page, 20000);
}

async function continueFromDesignEditor(page, projectId) {
  await waitForDesignEditor(page, 45000);
  activity(projectId, 'Spreadshirt Design products editor opened. Waiting for product creation…');
  await waitForProductsCreated(page, 45000);
  return true;
}

feature.prepare = async function prepareWithDraftRecovery(projectId) {
  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt gate check failed: ${gate.errors.join(' ')}`);

  let project = this.projects.read(projectId);
  const file = project.spreadshirt?.pngPath;
  if (!file || !fs.existsSync(file)) throw new Error('Spreadshirt upload artwork is missing.');
  const designTitle = designTitleFromFile(file);
  const { page } = await this.sessions.ensureService('spreadshirt');
  await page.bringToFront();

  try {
    await this.openDesigns(page);

    // Recovery-first: if a previous attempt already uploaded the design, open the newest
    // visible draft instead of creating a duplicate upload.
    if (project.spreadshirt?.uploadAcceptedAt || project.spreadshirt?.status === 'recovery-needed') {
      activity(projectId, `Looking for the already uploaded Spreadshirt draft “${designTitle}”…`);
      const recovered = await openUploadedDraftByTitle(page, designTitle, {
        timeoutMs: project.spreadshirt?.uploadAcceptedAt ? 20000 : 7000,
        allowAnyExisting: true
      });
      if (recovered.ok) {
        activity(projectId, `Recovered uploaded Spreadshirt draft “${designTitle}”. Continuing without re-uploading.`, 'spreadshirt');
        await continueFromDesignEditor(page, projectId);
      } else if (project.spreadshirt?.uploadAcceptedAt) {
        throw new Error(`Spreadshirt upload was already accepted, but the Draft card “${designTitle}” could not be opened. ZeroPOD will not upload it again.`);
      }
    }

    const editorText = await page.locator('body').innerText().catch(() => '');
    const alreadyInEditor = /Design products/i.test(editorText) && /Metadata|Publish on Spreadshirt/i.test(editorText);

    if (!alreadyInEditor) {
      await returnToMarketplaceDesigns(page);
      const beforeCount = await countVisibleDesignTitles(page, designTitle);
      activity(projectId, `Spreadshirt upload: opening Create New for “${designTitle}”…`);
      await openCreateNewDialog(page);
      activity(projectId, 'Spreadshirt Upload Design dialog opened. Selecting the regular 4500×5400 PNG…');
      await selectFileLikeVideo(page, file);
      activity(projectId, 'Artwork selected. Waiting for Spreadshirt Upload Status…');
      await waitForUploadResult(page, 60000);

      // Persist upload success immediately. Any later failure must recover this draft,
      // never upload the same project a second time.
      project = this.projects.read(projectId);
      this.projects.update(projectId, {
        spreadshirt: {
          ...(project.spreadshirt || {}),
          status: 'uploaded-draft',
          uploadAcceptedAt: new Date().toISOString(),
          uploadDesignTitle: designTitle,
          uploadFileName: path.basename(file),
          lastError: null
        }
      });
      activity(projectId, `Spreadshirt reported “Upload successful” for “${designTitle}”. Waiting for its Draft card…`, 'spreadshirt');

      const modal = page.getByRole('dialog').filter({ hasText: /Upload status/i }).first();
      if (await modal.count().catch(() => 0)) {
        await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await returnToMarketplaceDesigns(page);

      let opened = await openUploadedDraftByTitle(page, designTitle, {
        timeoutMs: 50000,
        minimumVisibleCount: Math.max(1, beforeCount + 1),
        allowAnyExisting: false
      });

      // Spreadshirt can reuse/virtualize the same card node, so if the count did not
      // increase, open the first visible exact-title Draft as the newest card fallback.
      if (!opened.ok) {
        opened = await openUploadedDraftByTitle(page, designTitle, {
          timeoutMs: 12000,
          allowAnyExisting: true
        });
      }

      if (!opened.ok) {
        // Keep the older href-based detector as a last resort only.
        try {
          await clickUploadedDesign(page, [], 5000);
          opened = { ok: true, method: 'legacy-href-fallback' };
        } catch {}
      }

      if (!opened.ok) {
        throw new Error(`Spreadshirt upload succeeded, but ZeroPOD could not open the Draft card “${designTitle}”. The upload is preserved and will not be repeated.`);
      }

      activity(projectId, `Opened uploaded Spreadshirt Draft “${designTitle}”.`, 'spreadshirt');
      await continueFromDesignEditor(page, projectId);
    }

    activity(projectId, 'Product creation is ready. Filling Spreadshirt name, description and tags…');
    project = this.projects.read(projectId);
    await this.fillMetadata(page, project.spreadshirt.metadata);

    const marketplaceEnabled = await enableSpreadshirtMarketplace(page);
    activity(projectId, marketplaceEnabled
      ? 'Publish on Spreadshirt marketplace enabled. Preparing final review…'
      : 'Spreadshirt metadata filled. Marketplace publishing was already enabled or not exposed separately.');

    const screenshotPath = path.join(this.projects.getProjectDir(projectId), 'spreadshirt-final-review.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    project = this.projects.read(projectId);
    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        status: 'review',
        preparedAt: new Date().toISOString(),
        editorUrl: page.url(),
        reviewScreenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : project.spreadshirt?.reviewScreenshotPath || null,
        lastError: null
      }
    });
    activity(projectId, 'Spreadshirt listing prepared. Waiting for final approval.', 'spreadshirt');
    return {
      ok: true,
      project: updated,
      url: page.url(),
      reviewScreenshotPath: updated.spreadshirt?.reviewScreenshotPath || null,
      message: 'Spreadshirt upload, product creation and metadata are prepared for final review.'
    };
  } catch (error) {
    project = this.projects.read(projectId);
    this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        status: 'recovery-needed',
        lastError: { message: error.message || String(error), at: new Date().toISOString() }
      }
    });
    activity(projectId, `Spreadshirt prepare failed: ${error.message || error}`, 'spreadshirt-error');
    throw error;
  }
};

module.exports = {
  designTitleFromFile,
  countVisibleDesignTitles,
  openUploadedDraftByTitle
};
