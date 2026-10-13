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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function designTitleFromFile(file) {
  return path.basename(String(file || ''), path.extname(String(file || ''))).trim();
}

function designIdFromEditorUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname !== 'partner.spreadshirt.com') return null;
    return url.pathname.match(/^\/mp\/designs\/([^/?#]+)\/?$/i)?.[1] || null;
  } catch {
    return null;
  }
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

async function snapshotMarketplaceCards(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const attrId = (root) => {
      const nodes = [root, ...root.querySelectorAll('*')];
      for (const node of nodes) {
        for (const name of node.getAttributeNames?.() || []) {
          const value = String(node.getAttribute(name) || '');
          const route = value.match(/\/mp\/designs\/([^/?#"']+)/i);
          if (route?.[1]) return route[1];
          if (/design/i.test(name) && /^[a-z0-9_-]{8,}$/i.test(value)) return value;
        }
      }
      return null;
    };
    const hrefFor = (root) => {
      const link = root.matches?.('a[href]') ? root : root.querySelector('a[href*="/designs/"]');
      if (!link?.href) return null;
      try { return new URL(link.href, location.href).href; } catch { return link.href; }
    };
    const imageKeyFor = (image) => {
      if (!image) return '';
      if (image.currentSrc) return image.currentSrc;
      if (image.src) return image.src;
      const bg = getComputedStyle(image).backgroundImage;
      if (bg && bg !== 'none') return bg;
      if (image.tagName === 'SVG') return String(image.outerHTML || '').slice(0, 1200);
      return String(image.getAttribute?.('data-src') || image.getAttribute?.('srcset') || '');
    };

    const cards = [];
    const seenGeometry = new Set();
    const statuses = [...document.querySelectorAll('body *')]
      .filter((el) => visible(el) && /^(Draft|Published|In review)$/i.test(norm(el.textContent)));

    for (const statusNode of statuses) {
      let node = statusNode;
      let card = null;
      for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 140 || rect.width > 700 || rect.height < 170 || rect.height > 950) continue;
        const image = node.querySelector('img,picture img,svg,canvas,[style*="background-image"]');
        if (!image || !visible(image)) continue;
        const imageRect = image.getBoundingClientRect();
        const href = hrefFor(node);
        const designId = href?.match(/\/mp\/designs\/([^/?#]+)/i)?.[1] || attrId(node);
        const imageKey = imageKeyFor(image);
        const text = norm(node.innerText || node.textContent || '');
        const identity = designId
          ? `id:${designId}`
          : href
            ? `href:${href}`
            : imageKey
              ? `image:${imageKey}`
              : null;
        card = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          imageX: imageRect.x,
          imageY: imageRect.y,
          imageWidth: imageRect.width,
          imageHeight: imageRect.height,
          text,
          href,
          designId,
          imageKey,
          identity,
          status: /In review/i.test(norm(statusNode.textContent))
            ? 'In review'
            : /Published/i.test(norm(statusNode.textContent))
              ? 'Published'
              : 'Draft'
        };
        break;
      }
      if (!card) continue;
      const geometry = `${Math.round(card.x)}:${Math.round(card.y)}:${Math.round(card.width)}:${Math.round(card.height)}`;
      if (seenGeometry.has(geometry)) continue;
      seenGeometry.add(geometry);
      cards.push(card);
    }

    cards.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return cards;
  }).catch(() => []);
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

async function waitForGenuinelyNewDesignCard(page, beforeCards, projectId, timeoutMs = 70000) {
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
      activity(projectId, `New Spreadshirt design card detected${fresh.designId ? ` (${fresh.designId})` : ''}. Opening only this new card…`);
      return { card: fresh, beforeDesignIds };
    }

    const first = cards[0] || null;
    if (first?.identity && previousFirst && first.identity !== previousFirst && !beforeIdentities.has(first.identity)) {
      activity(projectId, 'Spreadshirt first card changed after upload. Treating the changed card as the new upload…');
      return { card: first, beforeDesignIds };
    }

    if (Date.now() >= nextReloadAt) {
      activity(projectId, 'Upload succeeded, but the new card is not visible yet. Waiting for Spreadshirt to finish adding it…');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await waitForMarketplaceDesigns(page, 15000).catch(() => {});
      nextReloadAt = Date.now() + 3000;
    }
    await wait(500);
  }

  throw new Error('Spreadshirt upload succeeded, but ZeroPOD never saw a genuinely new design card. The upload is preserved; the previous first card was intentionally not opened.');
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

feature.prepare = async function prepareWithFreshUploadIdentity(projectId) {
  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt gate check failed: ${gate.errors.join(' ')}`);

  let project = this.projects.read(projectId);
  const file = project.spreadshirt?.pngPath;
  if (!file || !fs.existsSync(file)) throw new Error('Spreadshirt upload artwork is missing.');
  const designTitle = project.spreadshirt?.uploadDesignTitle || designTitleFromFile(file);
  const { page } = await this.sessions.ensureService('spreadshirt');
  await page.bringToFront().catch(() => {});

  try {
    // Resume only an exact editor/card identity that belongs to THIS project.
    if (project.spreadshirt?.uploadAcceptedAt && await resumeExactKnownDesign(page, project).catch(() => false)) {
      activity(projectId, `Resuming exact Spreadshirt design ${project.spreadshirt?.uploadDesignId || designIdFromEditorUrl(page.url())}; no upload repeated.`);
      return finishPreparedEditor(page, projectId);
    }

    // A brand-new project must never inherit the browser's previous design editor.
    // Always force the Designs index before taking the pre-upload snapshot.
    await forceMarketplaceDesigns(page);
    const beforeCards = await snapshotMarketplaceCards(page);
    const beforeIds = beforeCards.map((card) => card.designId).filter(Boolean);
    activity(projectId, `Captured ${beforeCards.length} existing Spreadshirt design card${beforeCards.length === 1 ? '' : 's'} before upload. Waiting for a NEW card after upload.`);

    await openCreateNewDialog(page);
    activity(projectId, `Spreadshirt Upload Design dialog opened for “${designTitle}”. Selecting the regular 4500×5400 PNG…`);
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
        preUploadDesignIds: beforeIds,
        uploadCardHref: null,
        uploadCardIdentity: null,
        uploadDesignId: null,
        editorUrl: null,
        lastError: null
      }
    });
    activity(projectId, `Spreadshirt reported “Upload successful” for “${designTitle}”. Waiting for the newly created design card to actually appear…`);

    const modal = page.getByRole('dialog').filter({ hasText: /Upload status/i }).first();
    if (await modal.count().catch(() => 0)) {
      await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    // Some Spreadshirt builds navigate directly into the new editor.
    let currentId = designIdFromEditorUrl(page.url());
    if (currentId && !new Set(beforeIds).has(currentId)) {
      project = this.projects.read(projectId);
      this.projects.update(projectId, {
        spreadshirt: {
          ...(project.spreadshirt || {}),
          uploadDesignId: currentId,
          editorUrl: page.url(),
          uploadCardHref: page.url(),
          uploadCardIdentity: `id:${currentId}`
        }
      });
      activity(projectId, `Spreadshirt opened the new editor directly (${currentId}). Continuing with this exact design.`);
      return finishPreparedEditor(page, projectId);
    }

    await forceMarketplaceDesigns(page);
    const fresh = await waitForGenuinelyNewDesignCard(page, beforeCards, projectId, 70000);
    const card = fresh.card;
    const opened = await clickCard(page, card);
    if (!opened) {
      throw new Error('The genuinely new Spreadshirt card appeared, but ZeroPOD could not open that card. The upload is preserved and no older card was used.');
    }

    await waitForDesignEditor(page, 45000);
    currentId = designIdFromEditorUrl(page.url());
    if (currentId && fresh.beforeDesignIds.has(currentId)) {
      throw new Error(`Spreadshirt opened previous design ${currentId} instead of the new upload. ZeroPOD stopped before changing the wrong design.`);
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
    activity(projectId, `Confirmed newly uploaded Spreadshirt design${currentId ? ` ID ${currentId}` : ''}. Previous cards will not be reused.`);
    return finishPreparedEditor(page, projectId);
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
  snapshotMarketplaceCards,
  waitForGenuinelyNewDesignCard,
  designIdFromEditorUrl
};
