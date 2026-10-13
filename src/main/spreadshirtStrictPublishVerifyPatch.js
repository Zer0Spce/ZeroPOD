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

function statusResult(designId, status, extra = {}) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'published') {
    return { verified: true, published: true, underReview: false, status: 'Published', designId, ...extra };
  }
  if (normalized === 'in review') {
    return { verified: true, published: true, underReview: true, status: 'In review', designId, ...extra };
  }
  if (normalized === 'draft') {
    return { verified: true, published: false, draft: true, status: 'Draft', designId, ...extra };
  }
  return null;
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

async function readEditorPublishStatus(page, designId) {
  if (designIdFromEditorUrl(page.url()) !== designId) return null;

  for (const frame of page.frames()) {
    const result = await frame.evaluate(() => {
      const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
      };

      const headings = [...document.querySelectorAll('body *')]
        .filter((el) => visible(el) && /^Publish on Spreadshirt$/i.test(norm(el.textContent)));

      for (const heading of headings) {
        let node = heading;
        for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
          if (!visible(node)) continue;
          const text = norm(node.innerText || node.textContent || '');
          if (!/Sell your products on the Spreadshirt marketplace/i.test(text)) continue;
          if (!/Design status/i.test(text)) continue;

          const statuses = [...node.querySelectorAll('*')]
            .filter((el) => visible(el) && /^(Draft|In review|Published)$/i.test(norm(el.textContent)));
          const exact = statuses.find((el) => {
            const textValue = norm(el.textContent);
            return textValue && ![...el.children].some((child) => norm(child.textContent) === textValue);
          }) || statuses[0];
          if (!exact) continue;

          return {
            status: norm(exact.textContent),
            cardText: text.slice(0, 700),
            source: 'exact-editor-publish-card'
          };
        }
      }
      return null;
    }).catch(() => null);

    if (result?.status) return result;
  }
  return null;
}

async function revealEditorMetadata(page) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.getByRole('tab', { name: /^Metadata$/i }).first(),
      frame.getByRole('button', { name: /^Metadata$/i }).first(),
      frame.getByRole('link', { name: /^Metadata$/i }).first(),
      frame.getByText(/^Metadata$/i, { exact: true }).first()
    ];
    for (const candidate of candidates) {
      try {
        if (!(await candidate.count()) || !(await candidate.isVisible()) || await candidate.isDisabled()) continue;
        await candidate.click({ force: true, timeout: 3000 });
        await wait(350);
        return true;
      } catch {}
    }
  }
  return false;
}

async function waitForEditorPublishStatus(page, designId, timeoutMs = 7000) {
  const started = Date.now();
  let metadataTried = false;
  while (Date.now() - started < timeoutMs) {
    const found = await readEditorPublishStatus(page, designId);
    if (found?.status) return found;
    if (!metadataTried && Date.now() - started > 1200) {
      metadataTried = true;
      await revealEditorMetadata(page).catch(() => {});
    }
    await wait(250);
  }
  return null;
}

async function readMarketplaceCardByDesignId(page, designId) {
  return page.evaluate((wantedId) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const attrContainsId = (el) => {
      if (!el?.getAttributeNames) return false;
      return el.getAttributeNames().some((name) => String(el.getAttribute(name) || '').includes(wantedId));
    };

    const identityNodes = [...document.querySelectorAll('a[href],button,[role="button"],[data-id],[data-design-id],[data-testid],[id]')]
      .filter((el) => visible(el) && attrContainsId(el));

    for (const identity of identityNodes) {
      let node = identity;
      for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 140 || rect.width > 700 || rect.height < 160 || rect.height > 950) continue;
        const statusNode = [...node.querySelectorAll('*')]
          .find((el) => visible(el) && /^(Draft|In review|Published)$/i.test(norm(el.textContent)));
        if (!statusNode) continue;
        const image = node.querySelector('img,picture img,svg,canvas,[style*="background-image"]');
        if (!image || !visible(image)) continue;
        return {
          status: norm(statusNode.textContent),
          text: norm(node.innerText || node.textContent || '').slice(0, 700),
          source: 'marketplace-exact-design-id-dom',
          identityTag: identity.tagName,
          identityHref: identity.getAttribute('href') || null
        };
      }
    }
    return null;
  }, designId).catch(() => null);
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

  if (designIdFromEditorUrl(page.url()) === designId) {
    const currentEditor = await waitForEditorPublishStatus(page, designId, 2500);
    const currentResult = statusResult(designId, currentEditor?.status, {
      source: currentEditor?.source || 'current-editor',
      editorUrl: page.url(),
      editorCard: currentEditor || null
    });
    if (currentResult) return currentResult;
  }

  const context = page.context();
  let verifyPage = null;
  try {
    verifyPage = await context.newPage();

    await verifyPage.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const directEditor = await waitForEditorPublishStatus(verifyPage, designId, 8000);
    const directResult = statusResult(designId, directEditor?.status, {
      source: directEditor?.source || 'direct-editor-url',
      editorUrl,
      editorCard: directEditor || null
    });
    if (directResult) return directResult;

    await verifyPage.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForMarketplaceDesigns(verifyPage, 20000).catch(() => {});

    let exactCard = await readMarketplaceCardByDesignId(verifyPage, designId);
    if (exactCard?.status) {
      const exactResult = statusResult(designId, exactCard.status, { source: exactCard.source, card: exactCard });
      if (exactResult) return exactResult;
    }

    const search = verifyPage.getByPlaceholder(/Name,\s*Id,\s*Tags/i).first();
    if (await search.count().catch(() => 0) && await search.isVisible().catch(() => false)) {
      await search.fill(designId).catch(() => {});
      await wait(900);
      exactCard = await readMarketplaceCardByDesignId(verifyPage, designId);
      if (exactCard?.status) {
        const exactResult = statusResult(designId, exactCard.status, { source: exactCard.source, card: exactCard });
        if (exactResult) return exactResult;
      }

      let cards = await readFilteredMarketplaceCards(verifyPage);
      if (cards.length === 1) {
        const filteredResult = statusResult(designId, cards[0].status, {
          source: 'single-card-after-exact-id-search',
          card: cards[0]
        });
        if (filteredResult) return filteredResult;
      }
      await wait(900);
      cards = await readFilteredMarketplaceCards(verifyPage);
      if (cards.length === 1) {
        const filteredResult = statusResult(designId, cards[0].status, {
          source: 'single-card-after-exact-id-search-retry',
          card: cards[0]
        });
        if (filteredResult) return filteredResult;
      }
      return {
        verified: false,
        reason: `exact-design-id-dom-not-found-search-returned-${cards.length}-cards`,
        designId,
        cards
      };
    }

    return { verified: false, reason: 'exact-design-id-status-not-found', designId };
  } catch (error) {
    return { verified: false, reason: error?.message || String(error), designId };
  } finally {
    if (verifyPage) await verifyPage.close().catch(() => {});
    await page.bringToFront().catch(() => {});
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
      publishVerificationSource: strict.source || null,
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

  activity(projectId, 'Clicked Spreadshirt “Save and publish”. Waiting for this exact design editor to become In review/Published…');
  const started = Date.now();
  let lastStrict = strict;
  while (Date.now() - started < 45000) {
    const text = await allFramesText(page);
    if (FAILURE.test(text)) throw new Error('Spreadshirt showed an error after Save and publish.');

    lastStrict = await strictMarketplaceStatus(page, this.projects.read(projectId));
    if (lastStrict.verified && lastStrict.published) {
      return markStrictPublished(projectId, page, lastStrict);
    }
    await wait(1400);
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
        if (status.authStatus !== 'verified') {
          reconcileScheduled = false;
          return;
        }
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
  statusResult,
  readEditorPublishStatus,
  waitForEditorPublishStatus,
  readMarketplaceCardByDesignId,
  strictMarketplaceStatus,
  readFilteredMarketplaceCards,
  clickSaveAndPublishTrusted,
  restoreFalsePublishedProject
};
