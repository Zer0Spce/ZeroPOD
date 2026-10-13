const { feature } = require('./spreadshirtAlphaIpc');
const {
  MARKETPLACE_DESIGNS_URL,
  waitForMarketplaceDesigns
} = require('./spreadshirtMarketplaceRoutePatch');
const {
  restoreDesignEditorForPublish,
  openProductsAndSetFullFront,
  returnToMetadata,
  ensurePublishSwitchOn,
  clickSaveAndPublish
} = require('./spreadshirtFinalApprovalSequencePatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FAILURE = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error|Something went wrong/i;

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function designIdFromEditorUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname !== 'partner.spreadshirt.com') return null;
    const match = url.pathname.match(/^\/mp\/designs\/([^/?#]+)\/?$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

async function allFramesText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 1200 });
      if (text) chunks.push(text);
    } catch {}
  }
  return chunks.join('\n');
}

async function readFilteredMarketplaceCards(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const cards = [];
    const seen = new Set();
    const statuses = [...document.querySelectorAll('body *')]
      .filter((el) => visible(el) && /^(Draft|Published|In review)$/i.test(norm(el.textContent)));

    for (const statusNode of statuses) {
      let node = statusNode;
      let card = null;
      for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 140 || rect.width > 620 || rect.height < 180 || rect.height > 900) continue;
        const image = node.querySelector('img,picture img,svg,canvas,[style*="background-image"]');
        if (!image || !visible(image)) continue;
        const text = norm(node.innerText || node.textContent || '');
        if (!text) continue;
        card = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          text,
          status: /^In review$/i.test(norm(statusNode.textContent))
            ? 'In review'
            : /^Published$/i.test(norm(statusNode.textContent))
              ? 'Published'
              : 'Draft'
        };
        break;
      }
      if (!card) continue;
      const key = `${Math.round(card.x)}:${Math.round(card.y)}:${Math.round(card.width)}:${Math.round(card.height)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(card);
    }

    cards.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return cards;
  }).catch(() => []);
}

async function strictMarketplaceStatus(page, project) {
  const editorUrl = project.spreadshirt?.editorUrl || project.spreadshirt?.publishedUrl || '';
  const designId = designIdFromEditorUrl(editorUrl);
  if (!designId) return { verified: false, reason: 'missing-design-id' };

  const context = page.context();
  let verifyPage = null;
  try {
    verifyPage = await context.newPage();
    await verifyPage.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForMarketplaceDesigns(verifyPage, 20000).catch(() => {});

    const search = verifyPage.getByPlaceholder(/Name,\s*Id,\s*Tags/i).first();
    if (!(await search.count().catch(() => 0)) || !(await search.isVisible().catch(() => false))) {
      return { verified: false, reason: 'marketplace-id-search-not-found', designId };
    }

    await search.fill(designId);
    await wait(900);

    let cards = await readFilteredMarketplaceCards(verifyPage);
    if (cards.length !== 1) {
      await wait(1000);
      cards = await readFilteredMarketplaceCards(verifyPage);
    }
    if (cards.length !== 1) {
      return { verified: false, reason: `exact-id-search-returned-${cards.length}-cards`, designId, cards };
    }

    const card = cards[0];
    const status = String(card.status || '').trim().toLowerCase();
    if (status === 'published') {
      return { verified: true, published: true, underReview: false, status: 'Published', designId, card };
    }
    if (status === 'in review') {
      return { verified: true, published: true, underReview: true, status: 'In review', designId, card };
    }
    if (status === 'draft') {
      return { verified: true, published: false, draft: true, status: 'Draft', designId, card };
    }
    return { verified: false, reason: 'unknown-exact-design-status', designId, card };
  } catch (error) {
    return { verified: false, reason: error?.message || String(error), designId };
  } finally {
    if (verifyPage) await verifyPage.close().catch(() => {});
  }
}

async function clickSaveAndPublishTrusted(page, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const frame of page.frames()) {
      const button = frame.getByRole('button', { name: /^Save and publish$/i }).first();
      try {
        if (!(await button.count()) || !(await button.isVisible()) || await button.isDisabled()) continue;
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await button.click({ timeout: 5000 });
        return { ok: true, method: 'trusted-playwright-button', label: 'Save and publish' };
      } catch {}
    }
    await wait(250);
  }

  const fallback = await clickSaveAndPublish(page, 3000).catch(() => ({ ok: false }));
  return fallback?.ok
    ? { ok: true, method: 'legacy-exact-button-fallback', label: 'Save and publish' }
    : { ok: false, visibleActions: fallback?.visibleActions || [] };
}

function removePublishLedgerEntry(projectId) {
  try {
    const ledger = feature.readLedger();
    const next = ledger.filter((entry) => entry.projectId !== projectId);
    if (next.length !== ledger.length) feature.writeLedger(next);
    return ledger.length - next.length;
  } catch {
    return 0;
  }
}

function restoreFalsePublishedProject(projectId, strict) {
  const current = feature.projects.read(projectId);
  removePublishLedgerEntry(projectId);
  const updated = feature.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      status: 'review',
      publishedAt: null,
      publishedUrl: null,
      reviewState: null,
      publishVerification: 'reverted-false-positive',
      publishVerificationDesignId: strict.designId || null,
      falsePublishRevertedAt: new Date().toISOString(),
      lastError: null
    }
  });
  activity(projectId, `Corrected false Spreadshirt Published state: exact design ${strict.designId || ''} is still Draft. Returned to Final Review and removed the false publish count.`, 'spreadshirt');
  return updated;
}

function markStrictPublished(projectId, page, strict) {
  const publishedAt = new Date().toISOString();
  const current = feature.projects.read(projectId);
  const publishedUrl = current.spreadshirt?.editorUrl || page.url();
  feature.recordPublish(projectId, publishedUrl);
  const updated = feature.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      status: 'published',
      publishedAt,
      publishedUrl,
      reviewState: strict.underReview ? 'under-review' : null,
      publishVerification: 'exact-design-id',
      publishVerificationDesignId: strict.designId,
      publishVerificationStatus: strict.status,
      lastError: null
    }
  });
  activity(projectId, `Spreadshirt exact design ${strict.designId} is ${strict.status}. Publish verified successfully.`, 'spreadshirt');
  return { ok: true, project: updated, publishedAt, url: publishedUrl, usage: feature.usage(), underReview: Boolean(strict.underReview) };
}

feature.publish = async function publishWithStrictDesignIdentity(projectId) {
  let project = this.projects.read(projectId);
  if (!project.spreadshirt?.preparedAt) throw new Error('Prepare the Spreadshirt listing and complete the final review first.');

  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt publish gate failed: ${gate.errors.join(' ')}`);
  project = this.projects.read(projectId);

  const { page } = await this.sessions.ensureService('spreadshirt');
  await this.ensureSignedIn(page);

  let strict = await strictMarketplaceStatus(page, project);
  if (strict.verified && strict.published) return markStrictPublished(projectId, page, strict);

  await restoreDesignEditorForPublish(page, projectId, project);
  await page.bringToFront().catch(() => {});
  await openProductsAndSetFullFront(page, projectId);
  await returnToMetadata(page, projectId);
  await ensurePublishSwitchOn(page, projectId);

  activity(projectId, 'Waiting for the exact Spreadshirt “Save and publish” button…');
  const action = await clickSaveAndPublishTrusted(page, 12000);
  if (!action.ok) {
    const labels = action.visibleActions?.length ? ` Visible actions: ${action.visibleActions.join(' | ')}` : '';
    throw new Error(`Spreadshirt “Save and publish” could not be clicked.${labels}`);
  }

  activity(projectId, 'Clicked Spreadshirt “Save and publish”. Waiting for the exact design ID to leave Draft…');
  const started = Date.now();
  let lastStrict = strict;
  while (Date.now() - started < 45000) {
    const text = await allFramesText(page);
    if (FAILURE.test(text)) throw new Error('Spreadshirt showed an error after Save and publish.');

    lastStrict = await strictMarketplaceStatus(page, this.projects.read(projectId));
    if (lastStrict.verified && lastStrict.published) {
      return markStrictPublished(projectId, page, lastStrict);
    }
    await wait(1800);
  }

  if (lastStrict?.verified && lastStrict?.draft) {
    throw new Error(`Spreadshirt “Save and publish” was clicked, but exact design ${lastStrict.designId} still shows Draft. ZeroPOD will not mark it Published.`);
  }
  throw new Error(`Spreadshirt “Save and publish” was clicked, but ZeroPOD could not verify the exact design ID as In review/Published${lastStrict?.reason ? ` (${lastStrict.reason})` : ''}.`);
};

const previousCheck = feature.check.bind(feature);
feature.check = async function checkWithPublishedReconciliation(projectId) {
  const project = this.projects.read(projectId);
  if (project.spreadshirt?.publishedAt && designIdFromEditorUrl(project.spreadshirt?.editorUrl || project.spreadshirt?.publishedUrl || '')) {
    try {
      const status = this.sessions.getStatuses().spreadshirt || {};
      if (status.authStatus === 'verified') {
        const { page } = await this.sessions.ensureService('spreadshirt');
        const strict = await strictMarketplaceStatus(page, project);
        if (strict.verified && strict.draft) restoreFalsePublishedProject(projectId, strict);
      }
    } catch {}
  }
  return previousCheck(projectId);
};

let reconcileScheduled = false;
let reconcileFinished = false;
const originalUsage = feature.usage.bind(feature);
feature.usage = function usageWithFalsePublishRepair() {
  const value = originalUsage();
  if (!reconcileScheduled && !reconcileFinished) {
    reconcileScheduled = true;
    setTimeout(async () => {
      try {
        const status = feature.sessions.getStatuses().spreadshirt || {};
        if (status.authStatus !== 'verified') return;
        const published = feature.projects.list({ includeArchived: true })
          .filter((project) => project.spreadshirt?.publishedAt && designIdFromEditorUrl(project.spreadshirt?.editorUrl || project.spreadshirt?.publishedUrl || ''));
        if (!published.length) {
          reconcileFinished = true;
          return;
        }
        const { page } = await feature.sessions.ensureService('spreadshirt');
        for (const project of published) {
          const strict = await strictMarketplaceStatus(page, project);
          if (strict.verified && strict.draft) restoreFalsePublishedProject(project.id, strict);
        }
        reconcileFinished = true;
      } catch {
        reconcileScheduled = false;
      }
    }, 600);
  }
  return value;
};

module.exports = {
  designIdFromEditorUrl,
  strictMarketplaceStatus,
  readFilteredMarketplaceCards,
  clickSaveAndPublishTrusted,
  restoreFalsePublishedProject
};
