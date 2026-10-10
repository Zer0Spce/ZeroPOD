const { ZeroPODBuiltInProvider } = require('./researchProvider');

const originalRefreshBestSellers = ZeroPODBuiltInProvider.prototype.refreshBestSellers;
const originalImportProduct = ZeroPODBuiltInProvider.prototype.importProduct;

const CUSTOM_PRODUCT_RE = /\b(?:custom(?:ized|isable|izable)?|personalized|personalised|your\s+(?:image|photo|design|text)|upload\s+(?:your|an?)|design\s+your\s+own|modify\s+by\s+amazon)\b/i;
const MERCH_SIGNAL_RE = /\b(?:amazon\s+merch\s+on\s+demand|merch\s+by\s+amazon)\b/i;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inspectMerchOnDemand(provider, item) {
  const title = String(item?.title || '').trim();
  if (!title) return { verified: false, reason: 'missing-title', evidence: null };

  // Custom-upload products are POD services, but they are not useful finished design
  // references for ZeroPOD Research, so keep them out of the design feed.
  if (CUSTOM_PRODUCT_RE.test(title)) {
    return { verified: false, reason: 'customizable-product', evidence: null };
  }

  const url = item.canonicalUrl;
  if (!url) return { verified: false, reason: 'missing-url', evidence: null };

  const { page } = await provider.ensurePage(item.marketplace, url);
  const signal = await page.evaluate(() => {
    const body = String(document.body?.innerText || '').replace(/\s+/g, ' ');
    const patterns = [
      /Amazon Merch on Demand prints designs[^.]{0,220}/i,
      /Amazon Merch on Demand[^.]{0,220}/i,
      /Merch by Amazon[^.]{0,220}/i
    ];
    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) return match[0].trim().slice(0, 260);
    }
    return null;
  });

  return signal
    ? { verified: true, reason: 'amazon-merch-signal', evidence: signal }
    : { verified: false, reason: 'no-amazon-merch-signal', evidence: null };
}

function persistVerification(provider, item, verification) {
  return provider.store.upsert({
    ...item,
    merchOnDemandVerified: Boolean(verification.verified),
    merchOnDemandEvidence: verification.evidence || null,
    merchOnDemandReason: verification.reason || null,
    merchOnDemandCheckedAt: new Date().toISOString()
  });
}

ZeroPODBuiltInProvider.prototype.refreshBestSellers = async function refreshVerifiedMerchBestSellers(payload = {}) {
  const result = await originalRefreshBestSellers.call(this, payload);
  const sourceItems = Array.isArray(result.items) ? result.items : [];
  const verified = [];
  let filteredOut = 0;

  for (const item of sourceItems) {
    let verification;
    try {
      verification = await inspectMerchOnDemand(this, item);
    } catch (error) {
      const message = error?.message || String(error);
      // Login / CAPTCHA requires explicit user action. Do not silently downgrade those
      // states into "not Merch" because that would make the result misleading.
      if (/captcha|robot check|requires sign-in|sign in normally|human-verification/i.test(message)) throw error;
      verification = { verified: false, reason: `verification-error: ${message}`, evidence: null };
    }

    const updated = persistVerification(this, item, verification);
    if (verification.verified) verified.push(updated);
    else filteredOut += 1;

    // A small pause keeps this detail-page verification intentionally conservative.
    await wait(180);
  }

  return {
    ...result,
    sourceCount: sourceItems.length,
    merchVerifiedCount: verified.length,
    merchFilteredOut: filteredOut,
    count: verified.length,
    items: verified
  };
};

ZeroPODBuiltInProvider.prototype.importProduct = async function importVerifiedMerchProduct(value, marketplaceHint = null) {
  const item = await originalImportProduct.call(this, value, marketplaceHint);
  const verification = await inspectMerchOnDemand(this, item);
  return persistVerification(this, item, verification);
};

module.exports = { MERCH_SIGNAL_RE, CUSTOM_PRODUCT_RE };
