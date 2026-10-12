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

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function findSearchInput(page) {
  const candidates = [
    page.getByPlaceholder(/Name,\s*Id,\s*Tags/i).first(),
    page.getByRole('textbox', { name: /search/i }).first(),
    page.locator('input[placeholder*="Name" i][placeholder*="Tags" i]').first(),
    page.locator('input[type="search"]').first()
  ];
  for (const candidate of candidates) {
    if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function filterMarketplaceByTitle(page, title) {
  const input = await findSearchInput(page);
  if (!input) return false;
  await input.fill(title).catch(async () => {
    await input.click({ force: true }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.type(title).catch(() => {});
  });
  await wait(700);
  return true;
}

async function cardGeometryForTitle(page, title) {
  return page.evaluate((wanted) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const wantedNorm = norm(wanted);
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const all = [...document.querySelectorAll('body *')];
    const exactTitles = all.filter((el) => visible(el) && norm(el.textContent) === wantedNorm);
    for (const titleEl of exactTitles) {
      let node = titleEl;
      let best = null;
      for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        const text = norm(node.innerText || node.textContent);
        const image = node.querySelector('img,picture img,svg,[style*="background-image"]');
        if (!text.includes(wantedNorm) || !image) continue;
        if (rect.width < 140 || rect.height < 160 || rect.width > 700 || rect.height > 850) continue;
        const imageRect = image.getBoundingClientRect();
        if (!visible(image)) continue;
        best = {
          card: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          image: { x: imageRect.x, y: imageRect.y, width: imageRect.width, height: imageRect.height },
          text: String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220)
        };
        if (/\bdraft\b/i.test(text)) return best;
      }
      if (best) return best;
    }
    return null;
  }, title).catch(() => null);
}

async function editorOpened(page, beforeUrl) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (/Design products/i.test(text) && /Metadata|Publish on Spreadshirt|Products/i.test(text)) return true;
  if (page.url() !== beforeUrl && !/\/mp\/designs(?:[/?#]|$)/i.test(page.url())) return true;
  return false;
}

async function clickCardGeometry(page, geometry) {
  if (!geometry) return false;
  const beforeUrl = page.url();
  const image = geometry.image || geometry.card;
  const card = geometry.card || geometry.image;

  const points = [
    { x: image.x + Math.max(4, image.width / 2), y: image.y + Math.max(4, image.height / 2) },
    { x: card.x + Math.max(4, card.width / 2), y: card.y + Math.min(card.height - 8, Math.max(12, card.height * 0.38)) },
    { x: card.x + Math.max(4, card.width / 2), y: card.y + Math.max(8, card.height / 2) }
  ];

  for (const point of points) {
    try {
      await page.mouse.click(point.x, point.y);
      const started = Date.now();
      while (Date.now() - started < 3500) {
        if (await editorOpened(page, beforeUrl)) return true;
        await wait(200);
      }
    } catch {}
  }

  try {
    await page.mouse.dblclick(points[0].x, points[0].y, { delay: 80 });
    const started = Date.now();
    while (Date.now() - started < 3500) {
      if (await editorOpened(page, beforeUrl)) return true;
      await wait(200);
    }
  } catch {}

  return false;
}

async function openVisibleDraftCard(page, title) {
  await filterMarketplaceByTitle(page, title).catch(() => false);
  await wait(500);
  const geometry = await cardGeometryForTitle(page, title);
  if (!geometry) return { ok: false, reason: 'card-not-found' };
  const clicked = await clickCardGeometry(page, geometry);
  return { ok: clicked, geometry, reason: clicked ? null : 'card-click-did-not-open-editor' };
}

async function countVisibleDesignTitles(page, title) {
  const geometry = await cardGeometryForTitle(page, title);
  return geometry ? 1 : 0;
}

async function openUploadedDraftByTitle(page, title, options = {}) {
  const timeoutMs = options.timeoutMs || 45000;
  const started = Date.now();
  let lastReloadAt = 0;
  let lastReason = 'not-seen';

  while (Date.now() - started < timeoutMs) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (HUMAN_CHECK_PATTERN.test(body)) {
      throw new Error('Spreadshirt is showing a human-verification challenge. Complete it manually, then retry.');
    }

    const result = await openVisibleDraftCard(page, title);
    if (result.ok) return { ok: true, title, visibleCount: 1, method: 'marketplace-search-card-click' };
    lastReason = result.reason || lastReason;

    if (Date.now() - lastReloadAt > 6500) {
      lastReloadAt = Date.now();
      if (!/\/mp\/designs(?:[/?#]|$)/i.test(page.url())) {
        await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      } else {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      }
      await waitForMarketplaceDesigns(page, 12000).catch(() => {});
    }
    await wait(450);
  }

  return { ok: false, title, visibleCount: 0, method: 'marketplace-search-card-click', reason: lastReason };
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
  const designTitle = project.spreadshirt?.uploadDesignTitle || designTitleFromFile(file);
  const { page } = await this.sessions.ensureService('spreadshirt');
  await page.bringToFront();

  try {
    await this.openDesigns(page);

    if (project.spreadshirt?.uploadAcceptedAt || project.spreadshirt?.status === 'recovery-needed') {
      activity(projectId, `Searching Spreadshirt Marketplace for the existing Draft “${designTitle}”…`);
      const recovered = await openUploadedDraftByTitle(page, designTitle, {
        timeoutMs: project.spreadshirt?.uploadAcceptedAt ? 30000 : 12000,
        allowAnyExisting: true
      });
      if (recovered.ok) {
        activity(projectId, `Opened existing Spreadshirt Draft “${designTitle}” through Marketplace search. Continuing without re-uploading.`, 'spreadshirt');
        await continueFromDesignEditor(page, projectId);
      } else if (project.spreadshirt?.uploadAcceptedAt) {
        throw new Error(`Spreadshirt upload was already accepted, but ZeroPOD could not open Draft “${designTitle}” through Marketplace search/card click. The upload is preserved and will not be repeated.`);
      }
    }

    const editorText = await page.locator('body').innerText().catch(() => '');
    const alreadyInEditor = /Design products/i.test(editorText) && /Metadata|Publish on Spreadshirt/i.test(editorText);

    if (!alreadyInEditor) {
      await returnToMarketplaceDesigns(page);
      activity(projectId, `Spreadshirt upload: opening Create New for “${designTitle}”…`);
      await openCreateNewDialog(page);
      activity(projectId, 'Spreadshirt Upload Design dialog opened. Selecting the regular 4500×5400 PNG…');
      await selectFileLikeVideo(page, file);
      activity(projectId, 'Artwork selected. Waiting for Spreadshirt Upload Status…');
      await waitForUploadResult(page, 60000);

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
      activity(projectId, `Spreadshirt reported “Upload successful” for “${designTitle}”. Searching for its Draft card…`, 'spreadshirt');

      const modal = page.getByRole('dialog').filter({ hasText: /Upload status/i }).first();
      if (await modal.count().catch(() => 0)) {
        await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await returnToMarketplaceDesigns(page);

      let opened = await openUploadedDraftByTitle(page, designTitle, { timeoutMs: 55000, allowAnyExisting: true });

      if (!opened.ok) {
        try {
          await clickUploadedDesign(page, [], 5000);
          opened = { ok: true, method: 'legacy-href-fallback' };
        } catch {}
      }

      if (!opened.ok) {
        throw new Error(`Spreadshirt upload succeeded, but ZeroPOD could not open Draft “${designTitle}” through Marketplace search/card click. The upload is preserved and will not be repeated.`);
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
  findSearchInput,
  filterMarketplaceByTitle,
  cardGeometryForTitle,
  openVisibleDraftCard,
  countVisibleDesignTitles,
  openUploadedDraftByTitle
};
