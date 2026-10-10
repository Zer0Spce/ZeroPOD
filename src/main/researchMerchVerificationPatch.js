const { ZeroPODBuiltInProvider } = require('./researchProvider');

const originalRefreshBestSellers = ZeroPODBuiltInProvider.prototype.refreshBestSellers;
const originalImportProduct = ZeroPODBuiltInProvider.prototype.importProduct;

// Bump whenever verification semantics change so bad historical negatives are never reused.
const VERIFICATION_VERSION = 3;
const POSITIVE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 12 * 60 * 60 * 1000;

const CUSTOM_PRODUCT_RE = /\b(?:custom(?:ized|isable|izable)?|personalized|personalised|your\s+(?:image|photo|design|text)|upload\s+(?:your|an?)|design\s+your\s+own|modify\s+by\s+amazon)\b/i;
const OBVIOUS_GENERIC_RE = /\b(?:gildan|hanes|true\s+classic|comfort\s+colors|fruit\s+of\s+the\s+loom|bella\s*\+?\s*canvas|next\s+level|heavy\s+cotton|ultra\s+cotton|beefy-?t|multipack|multi-?pack|\d+\s*-?\s*pack|plain\s+(?:tee|t-?shirt|shirt)|blank\s+(?:tee|t-?shirt|shirt))\b/i;
const MERCH_SIGNAL_RE = /\b(?:amazon\s+merch\s+on\s+demand|merch\s+by\s+amazon)\b/i;
const MERCH_CUSTOM_ID_RE = /(?:customId|customid)(?:=|%3D)B0752XJYNL/i;
const POD_TEMPLATE_PATTERNS = [
  {
    id: 'classic-fit-double-needle',
    regex: /\blightweight\b.{0,140}\bclassic\s+fit\b.{0,180}\bdouble[-\s]?needle\b.{0,160}\b(?:sleeve|bottom\s+hem)\b/i
  },
  {
    id: 'classic-fit-double-needle-short',
    regex: /\bclassic\s+fit\b.{0,140}\bdouble[-\s]?needle\b.{0,140}\b(?:sleeve|bottom\s+hem)\b/i
  },
  {
    id: 'hoodie-twill-neck',
    regex: /\b8[.,]5\s*oz\b.{0,160}\bclassic\s+fit\b.{0,160}\btwill[-\s]?taped\s+neck\b/i
  },
  {
    id: 'merch-fabric-template',
    regex: /\bsolid\s+colors?\s*:\s*100%\s+cotton\b.{0,240}\bheather\s+grey\b.{0,180}\ball\s+other\s+heathers\b/i
  }
];
const CHALLENGE_RE = /(?:robot\s+check|enter\s+the\s+characters\s+you\s+see\s+below|sorry,?\s+we\s+just\s+need\s+to\s+make\s+sure\s+you(?:'|’)re\s+not\s+a\s+robot|captcha)/i;

function compactText(value = '') {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#44;|&#x2c;/gi, ',')
    .replace(/\\u00a0/gi, ' ')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002c/gi, ',')
    .replace(/\\u002d/gi, '-')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptAround(text, index, length = 320) {
  const start = Math.max(0, Number(index || 0) - 90);
  return text.slice(start, Math.min(text.length, start + length)).trim().slice(0, length);
}

function qualifyingEvidence(value = '', extraUrl = '') {
  const raw = `${String(extraUrl || '')}\n${String(value || '')}`;
  const text = compactText(raw);

  const merch = text.match(MERCH_SIGNAL_RE);
  if (merch) {
    return {
      kind: 'amazon-merch-label',
      evidence: excerptAround(text, merch.index, 340)
    };
  }

  if (MERCH_CUSTOM_ID_RE.test(raw)) {
    return {
      kind: 'amazon-merch-custom-id',
      evidence: 'Amazon Merch on Demand customization template B0752XJYNL'
    };
  }

  for (const signature of POD_TEMPLATE_PATTERNS) {
    const match = text.match(signature.regex);
    if (match) {
      return {
        kind: `pod-template:${signature.id}`,
        evidence: excerptAround(text, match.index, 360)
      };
    }
  }

  return null;
}

function cachedVerification(item) {
  if (item?.merchVerificationVersion !== VERIFICATION_VERSION || !item?.merchOnDemandCheckedAt) return null;
  const checkedAt = new Date(item.merchOnDemandCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return null;
  const age = Date.now() - checkedAt;

  if (item.merchOnDemandVerified === true && age <= POSITIVE_CACHE_MS) {
    return {
      verified: true,
      reason: 'cached-positive',
      evidence: item.merchOnDemandEvidence || 'Verified Amazon POD / Merch design',
      kind: item.podVerificationKind || 'cached-positive',
      cached: true
    };
  }

  if (
    item.merchOnDemandVerified === false &&
    age <= NEGATIVE_CACHE_MS &&
    ['customizable-product', 'obvious-generic-apparel', 'no-pod-or-merch-signal'].includes(item.merchOnDemandReason)
  ) {
    return { verified: false, reason: item.merchOnDemandReason, evidence: null, kind: null, cached: true };
  }

  return null;
}

async function requestProbe(provider, item) {
  const { context } = await provider.sessions.ensureService('amazonResearch');
  let response;

  try {
    response = await context.request.get(item.canonicalUrl, {
      timeout: 10000,
      failOnStatusCode: false,
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache'
      }
    });
  } catch (error) {
    return { state: 'unknown', reason: `request-error: ${error?.message || error}` };
  }

  let html = '';
  try { html = await response.text(); }
  catch (error) { return { state: 'unknown', reason: `response-read-error: ${error?.message || error}` }; }

  const searchable = compactText(html);
  if (CHALLENGE_RE.test(searchable)) {
    throw new Error('Amazon is showing a CAPTCHA / robot check. ZeroPOD will not bypass it. Open Connections → Amazon Research, complete the normal browser challenge, then retry Refresh.');
  }

  const evidence = qualifyingEvidence(html, response.url?.() || item.canonicalUrl);
  if (evidence) {
    return {
      state: 'verified',
      reason: evidence.kind.startsWith('amazon-merch') ? 'amazon-merch-signal-http' : 'amazon-pod-template-http',
      evidence: evidence.evidence,
      kind: evidence.kind
    };
  }

  const hasProductIdentity = /id=["']productTitle["']/i.test(html) || /id=["']dp["']/i.test(html) || new RegExp(item.asin, 'i').test(html);
  const looksComplete = html.length >= 140000 && hasProductIdentity && response.status() < 500;

  // A full product page with none of the Merch/POD template signals is a useful negative.
  // Anything partial stays inconclusive and gets one short rendered-browser fallback.
  if (looksComplete) return { state: 'rejected', reason: 'no-pod-or-merch-signal' };
  return { state: 'unknown', reason: `incomplete-http-${response.status()}-${html.length}` };
}

async function browserProbe(provider, item) {
  const { page } = await provider.sessions.ensureService('amazonResearch');
  let navigationTimedOut = false;

  try {
    await page.goto(item.canonicalUrl, { waitUntil: 'commit', timeout: 6500 });
  } catch (error) {
    if (/timeout/i.test(error?.message || '')) navigationTimedOut = true;
    else return { state: 'unknown', reason: `browser-navigation-error: ${error?.message || error}` };
  }

  try {
    await page.locator('#productTitle, #title, body').first().waitFor({ state: 'attached', timeout: 2200 });
  } catch {}

  try { await provider.assertHumanAccess(page); }
  catch (error) { throw error; }

  const snapshot = await page.evaluate(() => ({
    title: document.querySelector('#productTitle, #title')?.textContent?.trim() || '',
    bodyText: String(document.body?.innerText || '').slice(0, 500000),
    html: String(document.documentElement?.innerHTML || '').slice(0, 1400000),
    url: location.href
  })).catch(() => ({ title: '', bodyText: '', html: '', url: '' }));

  const evidence = qualifyingEvidence(`${snapshot.bodyText}\n${snapshot.html}`, snapshot.url);
  if (evidence) {
    return {
      state: 'verified',
      reason: evidence.kind.startsWith('amazon-merch') ? 'amazon-merch-signal-browser' : 'amazon-pod-template-browser',
      evidence: evidence.evidence,
      kind: evidence.kind
    };
  }

  if (snapshot.title && snapshot.html.length >= 70000) {
    return { state: 'rejected', reason: 'no-pod-or-merch-signal' };
  }

  return { state: 'unknown', reason: navigationTimedOut ? 'browser-timeout-incomplete' : 'browser-incomplete' };
}

async function inspectMerchOnDemand(provider, item) {
  const title = String(item?.title || '').trim();
  if (!title) return { verified: false, reason: 'missing-title', evidence: null, kind: null };

  if (CUSTOM_PRODUCT_RE.test(title)) {
    return { verified: false, reason: 'customizable-product', evidence: null, kind: null };
  }

  // Reject obvious stock/basic inventory before opening product pages.
  if (OBVIOUS_GENERIC_RE.test(title)) {
    return { verified: false, reason: 'obvious-generic-apparel', evidence: null, kind: null };
  }

  const cached = cachedVerification(item);
  if (cached) return cached;

  if (!item.canonicalUrl) return { verified: null, reason: 'missing-url', evidence: null, kind: null };

  const http = await requestProbe(provider, item);
  if (http.state === 'verified') {
    return { verified: true, reason: http.reason, evidence: http.evidence, kind: http.kind };
  }
  if (http.state === 'rejected') {
    return { verified: false, reason: http.reason, evidence: null, kind: null };
  }

  const browser = await browserProbe(provider, item);
  if (browser.state === 'verified') {
    return { verified: true, reason: browser.reason, evidence: browser.evidence, kind: browser.kind };
  }
  if (browser.state === 'rejected') {
    return { verified: false, reason: browser.reason, evidence: null, kind: null };
  }

  return {
    verified: null,
    reason: browser.reason || http.reason || 'verification-inconclusive',
    evidence: null,
    kind: null
  };
}

function persistVerification(provider, item, verification) {
  const verified = verification.verified === true ? true : verification.verified === false ? false : null;
  return provider.store.upsert({
    ...item,
    merchOnDemandVerified: verified,
    merchOnDemandEvidence: verification.evidence || null,
    merchOnDemandReason: verification.reason || null,
    merchOnDemandCheckedAt: new Date().toISOString(),
    merchVerificationVersion: VERIFICATION_VERSION,
    podVerificationKind: verification.kind || null
  });
}

ZeroPODBuiltInProvider.prototype.refreshBestSellers = async function refreshVerifiedMerchBestSellers(payload = {}) {
  const result = await originalRefreshBestSellers.call(this, payload);
  const sourceItems = Array.isArray(result.items) ? result.items : [];
  const verified = [];
  let rejected = 0;
  let unknown = 0;
  let cached = 0;

  for (const item of sourceItems) {
    let verification;
    try {
      verification = await inspectMerchOnDemand(this, item);
    } catch (error) {
      const message = error?.message || String(error);
      if (/captcha|robot check|requires sign-in|sign in normally|human-verification/i.test(message)) throw error;
      verification = { verified: null, reason: `verification-error: ${message}`, evidence: null, kind: null };
    }

    if (verification.cached) cached += 1;
    const updated = persistVerification(this, item, verification);
    if (verification.verified === true) verified.push(updated);
    else if (verification.verified === false) rejected += 1;
    else unknown += 1;
  }

  return {
    ...result,
    category: 'Amazon POD / Merch designs',
    sourceCount: sourceItems.length,
    merchVerifiedCount: verified.length,
    merchRejectedCount: rejected,
    merchUnknownCount: unknown,
    merchCachedCount: cached,
    merchFilteredOut: rejected + unknown,
    count: verified.length,
    items: verified
  };
};

ZeroPODBuiltInProvider.prototype.importProduct = async function importVerifiedMerchProduct(value, marketplaceHint = null) {
  const item = await originalImportProduct.call(this, value, marketplaceHint);
  const verification = await inspectMerchOnDemand(this, item);
  return persistVerification(this, item, verification);
};

module.exports = {
  MERCH_SIGNAL_RE,
  MERCH_CUSTOM_ID_RE,
  POD_TEMPLATE_PATTERNS,
  CUSTOM_PRODUCT_RE,
  OBVIOUS_GENERIC_RE,
  VERIFICATION_VERSION
};
