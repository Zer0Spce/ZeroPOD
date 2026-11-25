const { feature } = require('./spreadshirtAlphaIpc');
const {
  MARKETPLACE_DESIGNS_URL,
  waitForMarketplaceDesigns
} = require('./spreadshirtMarketplaceRoutePatch');
const {
  designIdFromEditorUrl,
  readMarketplaceCardByDesignId
} = require('./spreadshirtStrictPublishVerifyPatch');
const { snapshotMarketplaceCards } = require('./spreadshirtFreshUploadIdentityPatch');
const {
  rollbackFalsePublishedState,
  collectForbiddenTerms
} = require('./spreadshirtForbiddenMetadataRepairPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function norm(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return norm(value).toLowerCase();
}

function hrefDesignId(value) {
  try {
    const url = new URL(String(value || ''));
    return url.pathname.match(/^\/mp\/designs\/([^/?#]+)\/?$/i)?.[1] || null;
  } catch {
    return null;
  }
}

function latestCardMatchesProject(card, project, designId) {
  if (!card) return { matched: false, reason: 'no-latest-card' };
  const spreadshirt = project.spreadshirt || {};
  const expectedId = spreadshirt.uploadDesignId || designId || null;
  const expectedIdentity = spreadshirt.uploadCardIdentity || null;
  const expectedHrefId = hrefDesignId(spreadshirt.uploadCardHref || spreadshirt.editorUrl || spreadshirt.publishedUrl || '');
  const expectedTitle = norm(spreadshirt.metadata?.title || '');
  const uploadTitle = norm(spreadshirt.uploadDesignTitle || '');
  const cardText = lower(card.text || '');

  if (expectedId && card.designId && String(card.designId) === String(expectedId)) {
    return { matched: true, reason: 'design-id' };
  }
  if (expectedIdentity && card.identity && String(card.identity) === String(expectedIdentity)) {
    return { matched: true, reason: 'stored-card-identity' };
  }
  const cardHrefId = hrefDesignId(card.href || '');
  if (expectedHrefId && cardHrefId && String(expectedHrefId) === String(cardHrefId)) {
    return { matched: true, reason: 'stored-card-href' };
  }
  if (expectedTitle && cardText.includes(expectedTitle.toLowerCase())) {
    return { matched: true, reason: 'metadata-title' };
  }
  if (uploadTitle && cardText.includes(uploadTitle.toLowerCase())) {
    return { matched: true, reason: 'upload-title' };
  }

  return {
    matched: false,
    reason: 'latest-card-does-not-match-project',
    expectedId,
    expectedTitle: expectedTitle || null,
    latestDesignId: card.designId || null,
    latestText: norm(card.text || '').slice(0, 240)
  };
}

function latestCardProof(card, match, designId) {
  const status = norm(card?.status || '');
  const normalized = status.toLowerCase();
  if (normalized === 'published' || normalized === 'in review') {
    return {
      verified: true,
      published: true,
      underReview: normalized === 'in review',
      status: normalized === 'in review' ? 'In review' : 'Published',
      designId: card.designId || designId || null,
      source: 'latest-matching-marketplace-card',
      matchReason: match.reason,
      card
    };
  }
  if (normalized === 'draft') {
    return {
      verified: true,
      published: false,
      draft: true,
      status: 'Draft',
      designId: card.designId || designId || null,
      source: 'latest-matching-marketplace-card',
      matchReason: match.reason,
      card,
      reason: 'latest-matching-card-still-draft'
    };
  }
  return null;
}

async function visibleValidationMessages(page) {
  const messages = [];
  const seen = new Set();
  const pattern = /not allowed|required|invalid|error|failed|must\b|at least|maximum|minimum|too long|too short|please (?:enter|select|remove|choose|fix)/i;
  for (const frame of page.frames()) {
    const found = await frame.evaluate((source) => {
      const matcher = new RegExp(source, 'i');
      const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
      };
      const nodes = [...document.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-invalid="true"], [class*="error" i], [class*="invalid" i]')];
      const out = [];
      for (const node of nodes) {
        if (!visible(node)) continue;
        let text = norm(node.innerText || node.textContent || '');
        if (!text && node.getAttribute?.('aria-invalid') === 'true') {
          const parent = node.parentElement;
          text = norm(parent?.innerText || parent?.textContent || '');
        }
        if (!text || text.length > 320 || !matcher.test(text)) continue;
        out.push(text);
      }
      return out;
    }, pattern.source).catch(() => []);
    for (const raw of found || []) {
      const text = String(raw || '').trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      messages.push(text);
    }
  }
  return messages.slice(0, 8);
}

async function verifyExactMarketplaceCard(page, project, timeoutMs = 30000) {
  const editorUrl = project.spreadshirt?.editorUrl || project.spreadshirt?.publishedUrl || '';
  const designId = project.spreadshirt?.uploadDesignId || designIdFromEditorUrl(editorUrl);
  if (!designId) return { verified: false, reason: 'missing-design-id', status: null, designId: null };

  const context = page.context();
  let verifyPage = null;
  let searchFilled = false;
  let lastCard = null;
  let lastLatest = null;
  let lastLatestMatch = null;
  try {
    verifyPage = await context.newPage();
    await verifyPage.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForMarketplaceDesigns(verifyPage, 20000).catch(() => {});

    const started = Date.now();
    let nextReloadAt = Date.now() + 3000;
    while (Date.now() - started < timeoutMs) {
      // Strongest proof: Spreadshirt exposes the exact design ID in the card DOM.
      lastCard = await readMarketplaceCardByDesignId(verifyPage, designId);
      if (lastCard?.status) {
        const normalized = String(lastCard.status).trim().toLowerCase();
        if (normalized === 'published' || normalized === 'in review') {
          return {
            verified: true,
            published: true,
            underReview: normalized === 'in review',
            status: normalized === 'in review' ? 'In review' : 'Published',
            designId,
            source: 'exact-marketplace-card-id',
            card: lastCard
          };
        }
        if (normalized !== 'draft') {
          return { verified: false, reason: `unexpected-exact-card-status-${normalized}`, status: lastCard.status, designId, card: lastCard };
        }
      }

      // Spreadshirt often hides the design ID from the Designs-grid DOM. In that
      // case use the newest/top-left card, but only when it can be tied back to
      // this exact ZeroPOD project by ID, saved identity/href, or listing title.
      const cards = await snapshotMarketplaceCards(verifyPage).catch(() => []);
      lastLatest = cards?.[0] || null;
      lastLatestMatch = latestCardMatchesProject(lastLatest, project, designId);
      if (lastLatest && lastLatestMatch.matched) {
        const latestProof = latestCardProof(lastLatest, lastLatestMatch, designId);
        if (latestProof?.published) return latestProof;
        if (latestProof?.draft) {
          // Give Spreadshirt time to flip Draft -> In review/Published after the
          // physical Save and publish click instead of failing immediately.
        }
      }

      if (!searchFilled && Date.now() - started > 1500) {
        const search = verifyPage.getByPlaceholder(/Name,\s*Id,\s*Tags/i).first();
        try {
          if (await search.count() && await search.isVisible()) {
            await search.fill(designId);
            searchFilled = true;
          }
        } catch {}
      }

      if (Date.now() >= nextReloadAt) {
        await verifyPage.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await waitForMarketplaceDesigns(verifyPage, 12000).catch(() => {});
        nextReloadAt = Date.now() + 3000;
      }
      await wait(900);
    }

    if (lastCard?.status) {
      return {
        verified: true,
        published: false,
        draft: String(lastCard.status).trim().toLowerCase() === 'draft',
        status: lastCard.status,
        designId,
        source: 'exact-marketplace-card-id',
        card: lastCard,
        reason: 'exact-card-did-not-become-in-review-or-published'
      };
    }

    if (lastLatest && lastLatestMatch?.matched) {
      const latestProof = latestCardProof(lastLatest, lastLatestMatch, designId);
      if (latestProof) return latestProof;
    }

    return {
      verified: false,
      published: false,
      reason: lastLatest
        ? `exact-design-id-card-not-found-and-latest-card-${lastLatestMatch?.reason || 'did-not-match'}`
        : 'exact-design-id-card-not-found-and-no-latest-card',
      status: lastLatest?.status || null,
      designId,
      latestCard: lastLatest,
      latestMatch: lastLatestMatch
    };
  } catch (error) {
    return {
      verified: false,
      published: false,
      reason: error?.message || String(error),
      status: lastCard?.status || lastLatest?.status || null,
      designId,
      card: lastCard,
      latestCard: lastLatest,
      latestMatch: lastLatestMatch
    };
  } finally {
    if (verifyPage) await verifyPage.close().catch(() => {});
    await page.bringToFront().catch(() => {});
  }
}

function persistExactProof(projectId, proof) {
  const current = feature.projects.read(projectId);
  return feature.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      status: 'published',
      reviewState: proof.underReview ? 'under-review' : null,
      publishVerification: proof.source || 'marketplace-designs-proof',
      publishVerificationDesignId: proof.designId,
      publishVerificationStatus: proof.status,
      publishVerificationSource: proof.source,
      exactGridVerifiedAt: new Date().toISOString(),
      lastError: null
    }
  });
}

const previousPublish = feature.publish.bind(feature);
feature.publish = async function publishWithExactMarketplaceCardProof(projectId) {
  const { page } = await this.sessions.ensureService('spreadshirt');
  await this.sessions.focusAutomationWindow?.('spreadshirt', page).catch(() => {});

  let result = await previousPublish(projectId);

  const project = this.projects.read(projectId);
  const proof = await verifyExactMarketplaceCard(page, project, 30000);
  if (proof.verified && proof.published) {
    const updated = persistExactProof(projectId, proof);
    const where = proof.source === 'latest-matching-marketplace-card'
      ? `newest matching Designs card (${proof.matchReason})`
      : 'exact design-ID card';
    activity(projectId, `Spreadshirt ${where} is ${proof.status}. Final publish proof passed.`);
    return { ...result, ok: true, project: updated, underReview: Boolean(proof.underReview), exactGridProof: proof };
  }

  rollbackFalsePublishedState(projectId, 'marketplace-designs-publish-proof');
  const forbidden = await collectForbiddenTerms(page).catch(() => []);
  const validation = await visibleValidationMessages(page).catch(() => []);
  const details = [];
  if (proof?.status) details.push(`latest/exact card status: ${proof.status}`);
  if (forbidden?.length) details.push(`forbidden metadata: ${forbidden.join(', ')}`);
  if (validation?.length) details.push(`visible validation: ${validation.join(' | ')}`);
  if (proof?.reason) details.push(`verification: ${proof.reason}`);

  activity(projectId, `Spreadshirt was NOT verified as published. ${details.join(' · ') || 'Neither the exact-ID card nor the newest matching card proved In review/Published.'} The existing upload is preserved.`, 'spreadshirt-error');
  await this.sessions.focusAutomationWindow?.('spreadshirt', page).catch(() => {});
  throw new Error(`Spreadshirt did not publish this exact design. ZeroPOD corrected the false Published state and kept the existing upload.${details.length ? ` ${details.join(' · ')}` : ''}`);
};

module.exports = {
  verifyExactMarketplaceCard,
  visibleValidationMessages,
  latestCardMatchesProject,
  latestCardProof
};
