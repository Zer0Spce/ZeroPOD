const { feature } = require('./spreadshirtAlphaIpc');
const {
  MARKETPLACE_DESIGNS_URL,
  waitForMarketplaceDesigns
} = require('./spreadshirtMarketplaceRoutePatch');
const {
  designIdFromEditorUrl,
  readMarketplaceCardByDesignId
} = require('./spreadshirtStrictPublishVerifyPatch');
const {
  rollbackFalsePublishedState,
  collectForbiddenTerms
} = require('./spreadshirtForbiddenMetadataRepairPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
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
  const designId = designIdFromEditorUrl(editorUrl);
  if (!designId) return { verified: false, reason: 'missing-design-id', status: null, designId: null };

  const context = page.context();
  let verifyPage = null;
  let searchFilled = false;
  let lastCard = null;
  try {
    verifyPage = await context.newPage();
    await verifyPage.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForMarketplaceDesigns(verifyPage, 20000).catch(() => {});

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
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

      if (!searchFilled && Date.now() - started > 1500) {
        const search = verifyPage.getByPlaceholder(/Name,\s*Id,\s*Tags/i).first();
        try {
          if (await search.count() && await search.isVisible()) {
            await search.fill(designId);
            searchFilled = true;
          }
        } catch {}
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
    return { verified: false, published: false, reason: 'exact-design-id-card-not-found', status: null, designId };
  } catch (error) {
    return { verified: false, published: false, reason: error?.message || String(error), status: lastCard?.status || null, designId, card: lastCard };
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
      publishVerification: 'exact-marketplace-card-id',
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

  // Never trust an editor-side status, success-looking route, or local ledger entry
  // by itself. The exact uploaded design card on /mp/designs must independently say
  // In review or Published before the IPC call can resolve as success.
  const project = this.projects.read(projectId);
  const proof = await verifyExactMarketplaceCard(page, project, 30000);
  if (proof.verified && proof.published) {
    const updated = persistExactProof(projectId, proof);
    activity(projectId, `Spreadshirt exact design ${proof.designId} is ${proof.status} on the Marketplace Designs grid. Final publish proof passed.`);
    return { ...result, ok: true, project: updated, underReview: Boolean(proof.underReview), exactGridProof: proof };
  }

  rollbackFalsePublishedState(projectId, 'exact-grid-publish-proof');
  const forbidden = await collectForbiddenTerms(page).catch(() => []);
  const validation = await visibleValidationMessages(page).catch(() => []);
  const details = [];
  if (proof?.status) details.push(`exact card status: ${proof.status}`);
  if (forbidden?.length) details.push(`forbidden metadata: ${forbidden.join(', ')}`);
  if (validation?.length) details.push(`visible validation: ${validation.join(' | ')}`);
  if (proof?.reason) details.push(`verification: ${proof.reason}`);

  activity(projectId, `Spreadshirt was NOT verified as published. ${details.join(' · ') || 'The exact design card did not prove In review/Published.'} The existing upload is preserved.`, 'spreadshirt-error');
  await this.sessions.focusAutomationWindow?.('spreadshirt', page).catch(() => {});
  throw new Error(`Spreadshirt did not publish this exact design. ZeroPOD corrected the false Published state and kept the existing upload.${details.length ? ` ${details.join(' · ')}` : ''}`);
};

module.exports = { verifyExactMarketplaceCard, visibleValidationMessages };
