const { ZeroPODBuiltInProvider } = require('./researchProvider');

const originalRefreshBestSellers = ZeroPODBuiltInProvider.prototype.refreshBestSellers;
const originalImportProduct = ZeroPODBuiltInProvider.prototype.importProduct;

const VERIFICATION_VERSION = 2;
const POSITIVE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 12 * 60 * 60 * 1000;

const CUSTOM_PRODUCT_RE = /\b(?:custom(?:ized|isable|izable)?|personalized|personalised|your\s+(?:image|photo|design|text)|upload\s+(?:your|an?)|design\s+your\s+own|modify\s+by\s+amazon)\b/i;
const OBVIOUS_GENERIC_RE = /\b(?:gildan|hanes|true\s+classic|comfort\s+colors|fruit\s+of\s+the\s+loom|bella\s*\+?\s*canvas|next\s+level|heavy\s+cotton|ultra\s+cotton|beefy-?t|multipack|multi-?pack|\d+\s*-?\s*pack|plain\s+(?:tee|t-?shirt|shirt)|blank\s+(?:tee|t-?shirt|shirt))\b/i;
const MERCH_SIGNAL_RE = /\b(?:amazon\s+merch\s+on\s+demand|merch\s+by\s+amazon)\b/i;
const CHALLENGE_RE = /(?:robot\s+check|enter\s+the\s+characters\s+you\s+see\s+below|sorry,?\s+we\s+just\s+need\s+to\s+make\s+sure\s+you(?:'|’)re\s+not\s+a\s+robot|captcha)/i;

function compactText(value = '') {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\\u00a0/gi, ' ')
    .replace(/\\u0026/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function merchEvidence(value = '') {
  const text = compactText(value);
  const match = text.match(MERCH_SIGNAL_RE);
  if (!match) return null;
  const start = Math.max(0, match.index - 90);
  return text.slice(start, Math.min(text.length, match.index + match[0].length + 170)).trim().slice(0, 320);
}

function cachedVerification(item) {
  if (item?.merchVerificationVersion !== VERIFICATION_VERSION || !item?.merchOnDemandCheckedAt) return null;
  const checkedAt = new Date(item.merchOnDemandCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return null;
  const age = Date.now() - checkedAt;
  if (item.merchOnDemandVerified === true && age <= POSITIVE_CACHE_MS) {
    return { verified: true, reason: 'cached-positive', evidence: item.merchOnDemandEvidence || 'Amazon Merch on Demand', cached: true };
  }
  if (item.merchOnDemandVerified === false && age <= NEGATIVE_CACHE_MS && ['customizable-product', 'obvious-generic-apparel', 'no-amazon-merch-signal'].includes(item.merchOnDemandReason)) {
    return { verified: false, reason: item.merchOnDemandReason, evidence: null, cached: true };
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

  const evidence = merchEvidence(html);
  if (evidence) return { state: 'verified', reason: 'amazon-merch-signal-http', evidence };

  const hasProductIdentity = /id=["']productTitle["']/i.test(html) || /id=["']dp["']/i.test(html) || new RegExp(item.asin, 'i').test(html);
  if (response.status() >= 500 || !hasProductIdentity) {
    return { state: 'unknown', reason: `incomplete-http-${response.status()}` };
  }

  return { state: 'rejected', reason: 'no-amazon-merch-signal' };
}

async function browserProbe(provider, item) {
  const { page } = await provider.sessions.ensureService('amazonResearch');
  let navigationTimedOut = false;

  try {
    await page.goto(item.canonicalUrl, { waitUntil: 'commit', timeout: 9000 });
  } catch (error) {
    if (/timeout/i.test(error?.message || '')) navigationTimedOut = true;
    else return { state: 'unknown', reason: `browser-navigation-error: ${error?.message || error}` };
  }

  try {
    await page.locator('#productTitle, #title, body').first().waitFor({ state: 'attached', timeout: 3500 });
  } catch {}

  try { await provider.assertHumanAccess(page); }
  catch (error) { throw error; }

  const snapshot = await page.evaluate(() => ({
    title: document.querySelector('#productTitle, #title')?.textContent?.trim() || '',
    bodyText: String(document.body?.innerText || '').slice(0, 450000),
    html: String(document.documentElement?.innerHTML || '').slice(0, 1200000)
  })).catch(() => ({ title: '', bodyText: '', html: '' }));

  const evidence = merchEvidence(`${snapshot.bodyText}\n${snapshot.html}`);
  if (evidence) return { state: 'verified', reason: 'amazon-merch-signal-browser', evidence };

  if (snapshot.title) return { state: 'rejected', reason: 'no-amazon-merch-signal' };
  return { state: 'unknown', reason: navigationTimedOut ? 'browser-timeout-incomplete' : 'browser-incomplete' };
}

async function inspectMerchOnDemand(provider, item) {
  const title = String(item?.title || '').trim();
  if (!title) return { verified: false, reason: 'missing-title', evidence: null };

  if (CUSTOM_PRODUCT_RE.test(title)) {
    return { verified: false, reason: 'customizable-product', evidence: null };
  }

  // Reject obvious stock/basic apparel before opening product pages. This is the main
  // speed win and prevents blank Gildan/Hanes-style inventory from entering Research.
  if (OBVIOUS_GENERIC_RE.test(title)) {
    return { verified: false, reason: 'obvious-generic-apparel', evidence: null };
  }

  const cached = cachedVerification(item);
  if (cached) return cached;

  if (!item.canonicalUrl) return { verified: null, reason: 'missing-url', evidence: null };

  const http = await requestProbe(provider, item);
  if (http.state === 'verified') return { verified: true, reason: http.reason, evidence: http.evidence };
  if (http.state === 'rejected') return { verified: false, reason: http.reason, evidence: null };

  // Only fall back to a browser navigation when the fast authenticated request was
  // inconclusive. The short timeout prevents one slow Amazon page from blocking the feed.
  const browser = await browserProbe(provider, item);
  if (browser.state === 'verified') return { verified: true, reason: browser.reason, evidence: browser.evidence };
  if (browser.state === 'rejected') return { verified: false, reason: browser.reason, evidence: null };
  return { verified: null, reason: browser.reason || http.reason || 'verification-inconclusive', evidence: null };
}

function persistVerification(provider, item, verification) {
  const verified = verification.verified === true ? true : verification.verified === false ? false : null;
  return provider.store.upsert({
    ...item,
    merchOnDemandVerified: verified,
    merchOnDemandEvidence: verification.evidence || null,
    merchOnDemandReason: verification.reason || null,
    merchOnDemandCheckedAt: new Date().toISOString(),
    merchVerificationVersion: VERIFICATION_VERSION
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
      verification = { verified: null, reason: `verification-error: ${message}`, evidence: null };
    }

    if (verification.cached) cached += 1;
    const updated = persistVerification(this, item, verification);
    if (verification.verified === true) verified.push(updated);
    else if (verification.verified === false) rejected += 1;
    else unknown += 1;
  }

  const cleanCategory = /^skip\s+to$/i.test(String(result.category || '').trim())
    ? 'Amazon Merch on Demand'
    : result.category;

  return {
    ...result,
    category: cleanCategory,
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

module.exports = { MERCH_SIGNAL_RE, CUSTOM_PRODUCT_RE, OBVIOUS_GENERIC_RE, VERIFICATION_VERSION };
