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

async function clearMarketplaceSearch(page) {
  const input = await findSearchInput(page);
  if (!input) return false;
  const value = await input.inputValue().catch(() => '');
  if (!value) return true;
  await input.fill('').catch(async () => {
    await input.click({ force: true }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
  });
  await wait(500);
  return true;
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

async function marketplaceCards(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const cards = [];
    const seen = new Set();
    const statusNodes = [...document.querySelectorAll('body *')]
      .filter((el) => visible(el) && /^(Draft|Published)$/i.test(norm(el.textContent)));

    for (const status of statusNodes) {
      let node = status;
      let candidate = null;
      for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 150 || rect.width > 520 || rect.height < 220 || rect.height > 850) continue;
        const text = norm(node.innerText || node.textContent);
        if (!text || !/\b(Draft|Published)\b/i.test(text)) continue;
        const image = node.querySelector('img,picture img,svg,canvas,[style*="background-image"]');
        if (!image || !visible(image)) continue;
        const imageRect = image.getBoundingClientRect();
        candidate = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          imageX: imageRect.x,
          imageY: imageRect.y,
          imageWidth: imageRect.width,
          imageHeight: imageRect.height,
          text,
          status: /\bDraft\b/i.test(text) ? 'Draft' : 'Published'
        };
        break;
      }
      if (!candidate) continue;
      const key = `${Math.round(candidate.x)}:${Math.round(candidate.y)}:${Math.round(candidate.width)}:${Math.round(candidate.height)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(candidate);
    }

    cards.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return cards;
  }).catch(() => []);
}

async function firstMarketplaceCard(page) {
  const cards = await marketplaceCards(page);
  return cards[0] || null;
}

async function editorOpened(page, beforeUrl) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (/Design products/i.test(text) && /Metadata|Publish on Spreadshirt|Products/i.test(text)) return true;
  if (page.url() !== beforeUrl && !/\/mp\/designs(?:[/?#]|$)/i.test(page.url())) return true;
  return false;
}

async function clickMarketplaceCard(page, card) {
  if (!card) return false;
  const beforeUrl = page.url();
  const points = [
    {
      x: card.imageX + Math.max(6, card.imageWidth / 2),
      y: card.imageY + Math.max(6, card.imageHeight / 2)
    },
    {
      x: card.x + Math.max(8, card.width / 2),
      y: card.y + Math.min(card.height - 12, Math.max(18, card.height * 0.4))
    },
    {
      x: card.x + Math.max(8, card.width / 2),
      y: card.y + Math.max(12, card.height / 2)
    }
  ];

  for (const point of points) {
    try {
      await page.mouse.click(point.x, point.y);
      const started = Date.now();
      while (Date.now() - started < 4000) {
        if (await editorOpened(page, beforeUrl)) return true;
        await wait(200);
      }
    } catch {}
  }
  return false;
}

async function openNewestCardIfExpected(page, title, timeoutMs = 30000) {
  const expected = normalize(title);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await clearMarketplaceSearch(page).catch(() => {});
    const card = await firstMarketplaceCard(page);
    if (card) {
      const text = normalize(card.text);
      if (text.includes(expected)) {
        const opened = await clickMarketplaceCard(page, card);
        if (opened) return { ok: true, card, method: 'first-card' };
        return { ok: false, card, reason: 'first-card-click-did-not-open-editor' };
      }
      return { ok: false, card, reason: 'first-card-title-mismatch' };
    }
    await wait(500);
  }
  return { ok: false, card: null, reason: 'no-design-cards' };
}

async function verifyExpectedDraftExists(page, title, passes = 3) {
  const expected = normalize(title);
  let lastCard = null;
  for (let pass = 1; pass <= passes; pass += 1) {
    if (!/\/mp\/designs(?:[/?#]|$)/i.test(page.url())) {
      await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    await waitForMarketplaceDesigns(page, 15000).catch(() => {});
    await clearMarketplaceSearch(page).catch(() => {});
    await wait(500);

    const card = await firstMarketplaceCard(page);
    lastCard = card;
    if (card && normalize(card.text).includes(expected)) {
      return { present: true, card, pass };
    }

    // Safety fallback: an older expected Draft may still exist if something newer was uploaded manually.
    if (await filterMarketplaceByTitle(page, title).catch(() => false)) {
      const filtered = await firstMarketplaceCard(page);
      if (filtered && normalize(filtered.text).includes(expected)) {
        return { present: true, card: filtered, pass, filtered: true };
      }
    }

    if (pass < passes) {
      await clearMarketplaceSearch(page).catch(() => {});
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await wait(700);
    }
  }
  await clearMarketplaceSearch(page).catch(() => {});
  return { present: false, card: lastCard, pass: passes };
}

async function returnToMarketplaceDesigns(page) {
  if (!/\/mp\/designs(?:[/?#]|$)/i.test(page.url())) {
    await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await waitForMarketplaceDesigns(page, 20000);
  await clearMarketplaceSearch(page).catch(() => {});
}

async function continueFromDesignEditor(page, projectId) {
  await waitForDesignEditor(page, 45000);
  activity(projectId, 'Spreadshirt Design products editor opened. Waiting for product creation…');
  await waitForProductsCreated(page, 45000);
  return true;
}

feature.prepare = async function prepareWithNewestCardRecovery(projectId) {
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

    // Resume safety: verify the accepted Draft still really exists before suppressing a re-upload.
    if (project.spreadshirt?.uploadAcceptedAt) {
      activity(projectId, `Checking whether the previously uploaded Spreadshirt Draft “${designTitle}” still exists…`);
      const presence = await verifyExpectedDraftExists(page, designTitle, 3);
      if (presence.present) {
        activity(projectId, `Found existing Spreadshirt Draft “${designTitle}”. Opening it without re-uploading…`);
        if (await clickMarketplaceCard(page, presence.card)) {
          await continueFromDesignEditor(page, projectId);
        } else {
          throw new Error(`Spreadshirt Draft “${designTitle}” exists, but ZeroPOD could not open it. Upload remains protected from duplicates.`);
        }
      } else {
        activity(projectId, `The saved Spreadshirt upload marker is stale: “${designTitle}” is no longer on the Designs page. Clearing it and uploading again normally.`, 'spreadshirt');
        project = this.projects.read(projectId);
        this.projects.update(projectId, {
          spreadshirt: {
            ...(project.spreadshirt || {}),
            status: 'export-ready',
            uploadAcceptedAt: null,
            uploadDesignTitle: null,
            uploadFileName: null,
            lastError: null
          }
        });
        project = this.projects.read(projectId);
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
      activity(projectId, `Spreadshirt reported “Upload successful” for “${designTitle}”. Opening the newest first design card…`, 'spreadshirt');

      const modal = page.getByRole('dialog').filter({ hasText: /Upload status/i }).first();
      if (await modal.count().catch(() => 0)) {
        await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await returnToMarketplaceDesigns(page);

      let opened = await openNewestCardIfExpected(page, designTitle, 30000);
      if (!opened.ok) {
        // Give Spreadshirt a short refresh window if the list has not reordered yet.
        for (let retry = 1; retry <= 2 && !opened.ok; retry += 1) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          await waitForMarketplaceDesigns(page, 15000).catch(() => {});
          await wait(700);
          opened = await openNewestCardIfExpected(page, designTitle, 7000);
        }
      }

      if (!opened.ok) {
        try {
          await clickUploadedDesign(page, [], 5000);
          opened = { ok: true, method: 'legacy-href-fallback' };
        } catch {}
      }

      if (!opened.ok) {
        throw new Error(`Spreadshirt upload succeeded, but the newest first card did not match/open “${designTitle}”. The upload is preserved and will not be repeated until ZeroPOD verifies the Draft is absent.`);
      }

      activity(projectId, `Opened newest Spreadshirt design “${designTitle}”.`, 'spreadshirt');
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
  clearMarketplaceSearch,
  filterMarketplaceByTitle,
  marketplaceCards,
  firstMarketplaceCard,
  clickMarketplaceCard,
  openNewestCardIfExpected,
  verifyExpectedDraftExists
};
