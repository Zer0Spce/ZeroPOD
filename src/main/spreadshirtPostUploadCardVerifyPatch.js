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
  waitForDesignEditor,
  waitForProductsCreated,
  enableSpreadshirtMarketplace
} = require('./spreadshirtVideoFlowPatch');
const {
  snapshotMarketplaceCards,
  designIdFromEditorUrl
} = require('./spreadshirtFreshUploadIdentityPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function designTitleFromFile(file) {
  return path.basename(String(file || ''), path.extname(String(file || ''))).trim();
}

async function clearSearch(page) {
  const candidates = [
    page.getByPlaceholder(/Name,\s*Id,\s*Tags/i).first(),
    page.getByRole('textbox', { name: /search/i }).first(),
    page.locator('input[type="search"]').first()
  ];
  for (const input of candidates) {
    try {
      if (!(await input.count()) || !(await input.isVisible())) continue;
      if (await input.inputValue().catch(() => '')) await input.fill('');
      return true;
    } catch {}
  }
  return false;
}

async function forceMarketplaceDesigns(page) {
  const current = (() => {
    try { return new URL(page.url()); } catch { return null; }
  })();
  const atIndex = current?.hostname === 'partner.spreadshirt.com'
    && /^\/mp\/designs\/?$/i.test(current.pathname);
  if (!atIndex) {
    await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await waitForMarketplaceDesigns(page, 20000);
  await clearSearch(page).catch(() => {});
}

async function clickCard(page, card) {
  if (!card) return false;
  if (card.href) {
    await page.goto(card.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    if (designIdFromEditorUrl(page.url())) return true;
  }
  const x = card.imageX + Math.max(8, card.imageWidth / 2);
  const y = card.imageY + Math.max(8, card.imageHeight / 2);
  await page.mouse.click(x, y).catch(() => {});
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (designIdFromEditorUrl(page.url())) return true;
    const text = await page.locator('body').innerText().catch(() => '');
    if (/Design products/i.test(text) && /Metadata/i.test(text)) return true;
    await wait(250);
  }
  return false;
}

async function waitForVerifiedNewCard(page, beforeCards, projectId, uiConfirmed, timeoutMs = 90000) {
  const beforeIdentities = new Set((beforeCards || []).map((card) => card.identity).filter(Boolean));
  const beforeDesignIds = new Set((beforeCards || []).map((card) => card.designId).filter(Boolean));
  const previousFirst = beforeCards?.[0]?.identity || null;
  const started = Date.now();
  let nextReloadAt = Date.now() + 2500;

  while (Date.now() - started < timeoutMs) {
    await clearSearch(page).catch(() => {});
    const cards = await snapshotMarketplaceCards(page);
    const fresh = cards.find((card) => {
      if (!card.identity) return false;
      if (beforeIdentities.has(card.identity)) return false;
      if (card.designId && beforeDesignIds.has(card.designId)) return false;
      return true;
    });

    if (fresh) {
      activity(projectId, `Genuinely new Spreadshirt design card detected${fresh.designId ? ` (${fresh.designId})` : ''}. Upload is now verified.`);
      return { card: fresh, beforeDesignIds };
    }

    const first = cards[0] || null;
    if (first?.identity && previousFirst && first.identity !== previousFirst && !beforeIdentities.has(first.identity)) {
      activity(projectId, 'Spreadshirt first card changed to a new identity after upload. Upload is now verified.');
      return { card: first, beforeDesignIds };
    }

    if (Date.now() >= nextReloadAt) {
      activity(
        projectId,
        uiConfirmed
          ? 'Spreadshirt confirmed the upload, but the new card is not visible yet. Waiting for it to appear…'
          : 'Upload Status closed without a visible success banner. Checking Designs for the genuinely new card before recording success…'
      );
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await waitForMarketplaceDesigns(page, 15000).catch(() => {});
      nextReloadAt = Date.now() + 3000;
    }
    await wait(500);
  }

  if (uiConfirmed) {
    throw new Error('Spreadshirt reported upload success, but ZeroPOD could not verify a genuinely new design card. No previous design was opened.');
  }
  throw new Error('Spreadshirt returned to Designs after Upload Status, but ZeroPOD could not verify a genuinely new design card. Upload success was not recorded and no previous design was opened.');
}

function markUploadAccepted(projectId, file, designTitle, beforeIds, identity = {}) {
  const project = feature.projects.read(projectId);
  return feature.projects.update(projectId, {
    spreadshirt: {
      ...(project.spreadshirt || {}),
      status: 'uploaded-draft',
      uploadAcceptedAt: project.spreadshirt?.uploadAcceptedAt || new Date().toISOString(),
      uploadDesignTitle: designTitle,
      uploadFileName: path.basename(file),
      preUploadDesignIds: beforeIds,
      uploadCardHref: identity.href ?? project.spreadshirt?.uploadCardHref ?? null,
      uploadCardIdentity: identity.identity ?? project.spreadshirt?.uploadCardIdentity ?? null,
      uploadDesignId: identity.designId ?? project.spreadshirt?.uploadDesignId ?? null,
      editorUrl: identity.editorUrl ?? project.spreadshirt?.editorUrl ?? null,
      lastError: null
    }
  });
}

async function resumeExactKnownDesign(page, project) {
  const exactUrl = project.spreadshirt?.editorUrl || project.spreadshirt?.uploadCardHref || null;
  const expectedId = project.spreadshirt?.uploadDesignId || designIdFromEditorUrl(exactUrl);
  if (!exactUrl || !expectedId) return false;
  await page.goto(exactUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  if (designIdFromEditorUrl(page.url()) !== expectedId) return false;
  await waitForDesignEditor(page, 20000);
  return true;
}

async function finishPreparedEditor(page, projectId) {
  await waitForDesignEditor(page, 45000);
  activity(projectId, 'Spreadshirt Design products editor opened for the newly uploaded design. Waiting for product creation…');
  await waitForProductsCreated(page, 45000);

  let project = feature.projects.read(projectId);
  activity(projectId, 'Product creation is ready. Filling Spreadshirt name, description and tags…');
  await feature.fillMetadata(page, project.spreadshirt.metadata);

  const marketplaceEnabled = await enableSpreadshirtMarketplace(page);
  activity(projectId, marketplaceEnabled
    ? 'Publish on Spreadshirt marketplace enabled. Preparing final review…'
    : 'Spreadshirt metadata filled. Marketplace publishing was already enabled or not exposed separately.');

  const screenshotPath = path.join(feature.projects.getProjectDir(projectId), 'spreadshirt-final-review.png');
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

  project = feature.projects.read(projectId);
  const editorUrl = page.url();
  const designId = designIdFromEditorUrl(editorUrl) || project.spreadshirt?.uploadDesignId || null;
  const updated = feature.projects.update(projectId, {
    spreadshirt: {
      ...(project.spreadshirt || {}),
      status: 'review',
      preparedAt: new Date().toISOString(),
      editorUrl,
      uploadDesignId: designId,
      reviewScreenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : project.spreadshirt?.reviewScreenshotPath || null,
      lastError: null
    }
  });
  activity(projectId, `Spreadshirt listing prepared for final review${designId ? ` using design ID ${designId}` : ''}.`);
  return {
    ok: true,
    project: updated,
    url: editorUrl,
    reviewScreenshotPath: updated.spreadshirt?.reviewScreenshotPath || null,
    message: 'Spreadshirt upload, product creation and metadata are prepared for final review.'
  };
}

feature.prepare = async function prepareWithPostUploadCardVerification(projectId) {
  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt gate check failed: ${gate.errors.join(' ')}`);

  let project = this.projects.read(projectId);
  const file = project.spreadshirt?.pngPath;
  if (!file || !fs.existsSync(file)) throw new Error('Spreadshirt upload artwork is missing.');
  const designTitle = project.spreadshirt?.uploadDesignTitle || designTitleFromFile(file);
  const { page } = await this.sessions.ensureService('spreadshirt');
  await page.bringToFront().catch(() => {});

  try {
    if (project.spreadshirt?.uploadAcceptedAt && await resumeExactKnownDesign(page, project).catch(() => false)) {
      activity(projectId, `Resuming exact Spreadshirt design ${project.spreadshirt?.uploadDesignId || designIdFromEditorUrl(page.url())}; no upload repeated.`);
      return finishPreparedEditor(page, projectId);
    }

    await forceMarketplaceDesigns(page);
    const beforeCards = await snapshotMarketplaceCards(page);
    const beforeIds = beforeCards.map((card) => card.designId).filter(Boolean);
    activity(projectId, `Captured ${beforeCards.length} existing Spreadshirt design card${beforeCards.length === 1 ? '' : 's'} before upload. A new identity is required before upload success is recorded.`);

    await openCreateNewDialog(page);
    activity(projectId, `Spreadshirt Upload Design dialog opened for “${designTitle}”. Selecting the regular 4500×5400 PNG…`);
    await selectFileLikeVideo(page, file);
    activity(projectId, 'Artwork selected. Waiting for Spreadshirt Upload Status…');
    const uploadResult = await waitForUploadResult(page, 60000);
    const uiConfirmed = uploadResult?.confirmed === true;

    if (uiConfirmed) {
      activity(projectId, `Spreadshirt provided direct upload confirmation for “${designTitle}”. Verifying the exact new design identity…`);
    } else if (uploadResult?.needsCardVerification) {
      activity(projectId, 'Spreadshirt returned to Designs without leaving the success banner visible. Verifying the genuinely new card before recording upload success…');
    }

    const modal = page.getByRole('dialog').filter({ hasText: /Upload status/i }).first();
    if (await modal.count().catch(() => 0)) {
      await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    let currentId = designIdFromEditorUrl(page.url());
    if (currentId && !new Set(beforeIds).has(currentId)) {
      markUploadAccepted(projectId, file, designTitle, beforeIds, {
        href: page.url(),
        identity: `id:${currentId}`,
        designId: currentId,
        editorUrl: page.url()
      });
      activity(projectId, `Spreadshirt opened the genuinely new editor directly (${currentId}). Upload is verified.`);
      return finishPreparedEditor(page, projectId);
    }

    await forceMarketplaceDesigns(page);
    const fresh = await waitForVerifiedNewCard(page, beforeCards, projectId, uiConfirmed, 90000);
    const card = fresh.card;

    markUploadAccepted(projectId, file, designTitle, beforeIds, {
      href: card.href || null,
      identity: card.identity || null,
      designId: card.designId || null,
      editorUrl: null
    });
    activity(projectId, `Confirmed newly uploaded Spreadshirt card${card.designId ? ` ID ${card.designId}` : ''}. Opening only this card…`);

    const opened = await clickCard(page, card);
    if (!opened) {
      throw new Error('The genuinely new Spreadshirt card was verified, but ZeroPOD could not open it. The upload is preserved and no older card was used.');
    }

    await waitForDesignEditor(page, 45000);
    currentId = designIdFromEditorUrl(page.url());
    if (currentId && fresh.beforeDesignIds.has(currentId)) {
      throw new Error(`Spreadshirt opened previous design ${currentId} instead of the newly verified upload. ZeroPOD stopped before changing the wrong design.`);
    }

    project = this.projects.read(projectId);
    this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        uploadCardHref: card.href || page.url(),
        uploadCardIdentity: card.identity || (currentId ? `id:${currentId}` : null),
        uploadDesignId: currentId || card.designId || null,
        editorUrl: page.url(),
        lastError: null
      }
    });
    activity(projectId, `Exact newly uploaded Spreadshirt design${currentId ? ` ID ${currentId}` : ''} opened. Previous cards remain protected.`);
    return finishPreparedEditor(page, projectId);
  } catch (error) {
    project = this.projects.read(projectId);
    this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        status: project.spreadshirt?.uploadAcceptedAt ? 'uploaded-draft' : 'recovery-needed',
        lastError: { message: error.message || String(error), at: new Date().toISOString() }
      }
    });
    activity(projectId, `Spreadshirt prepare failed: ${error.message || error}`, 'spreadshirt-error');
    throw error;
  }
};

module.exports = {
  waitForVerifiedNewCard,
  markUploadAccepted
};
