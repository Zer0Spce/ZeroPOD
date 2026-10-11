const {
  ZeroPODBuiltInProvider,
  BEST_SELLER_PRESETS,
  canonicalAmazonUrl,
  classifyProduct,
  calculateWinnerScore
} = require('./researchProvider');

const AMAZON_MERCH_NODE = '21393915011';
const AMAZON_MERCH_URL = `https://www.amazon.com/b?ie=UTF8&node=${AMAZON_MERCH_NODE}`;
const MERCH_VERIFICATION_VERSION = 3;
const BSR_CACHE_MS = 6 * 60 * 60 * 1000;
const BSR_CONCURRENCY = 4;

function isTrustedMerchBrowseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'amazon.com' && url.pathname === '/b' && url.searchParams.get('node') === AMAZON_MERCH_NODE;
  } catch {
    return false;
  }
}

function numberFromText(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/\u00a0/g, ' ').match(/([\d,.]+)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function compactHtmlText(value = '') {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\u00a0/gi, ' ')
    .replace(/\\u0026/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function extractBsrFromHtml(html = '') {
  const text = compactHtmlText(html);
  const rankMatches = [...text.matchAll(/#\s*([\d,]+)\s+in\s+([^\n(#]{2,140})/gi)]
    .map((match) => ({
      rank: numberFromText(match[1]),
      category: String(match[2] || '').replace(/\s+/g, ' ').trim()
    }))
    .filter((item) => Number.isFinite(item.rank) && item.category);

  const unique = [];
  const seen = new Set();
  for (const item of rankMatches) {
    const key = `${item.rank}:${item.category.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  const primary = unique[0] || null;
  return {
    bsr: primary?.rank ?? null,
    bsrCategory: primary?.category || null,
    allBsr: unique.slice(0, 12)
  };
}

function recentBsr(previous) {
  if (!previous?.bsrCheckedAt) return null;
  const checked = new Date(previous.bsrCheckedAt).getTime();
  if (!Number.isFinite(checked) || Date.now() - checked > BSR_CACHE_MS) return null;
  return {
    bsr: previous.bsr ?? null,
    bsrCategory: previous.bsrCategory || null,
    allBsr: Array.isArray(previous.allBsr) ? previous.allBsr : [],
    bsrCheckedAt: previous.bsrCheckedAt,
    bsrStatus: previous.bsrStatus || (Number.isFinite(Number(previous.bsr)) ? 'cached' : 'not-found')
  };
}

async function fetchBsr(provider, item, previous = null) {
  const cached = recentBsr(previous);
  if (cached) return cached;

  const { context } = await provider.sessions.ensureService('amazonResearch');
  const checkedAt = new Date().toISOString();
  try {
    const response = await context.request.get(item.canonicalUrl, {
      timeout: 8000,
      failOnStatusCode: false,
      headers: { 'accept-language': 'en-US,en;q=0.9' }
    });
    const html = await response.text();
    const challenge = /robot\s+check|captcha|enter\s+the\s+characters\s+you\s+see\s+below/i.test(compactHtmlText(html));
    if (challenge) return { bsr: null, bsrCategory: null, allBsr: [], bsrCheckedAt: checkedAt, bsrStatus: 'challenge' };
    if (response.status() >= 500 || html.length < 30000) {
      return { bsr: previous?.bsr ?? null, bsrCategory: previous?.bsrCategory || null, allBsr: previous?.allBsr || [], bsrCheckedAt: checkedAt, bsrStatus: 'inconclusive' };
    }
    const parsed = extractBsrFromHtml(html);
    return {
      ...parsed,
      bsrCheckedAt: checkedAt,
      bsrStatus: Number.isFinite(parsed.bsr) ? 'verified' : 'not-found'
    };
  } catch {
    return {
      bsr: previous?.bsr ?? null,
      bsrCategory: previous?.bsrCategory || null,
      allBsr: previous?.allBsr || [],
      bsrCheckedAt: checkedAt,
      bsrStatus: 'inconclusive'
    };
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return results;
}

// The user supplied Amazon's dedicated Merch designs browse node. Use it as the
// built-in US source instead of a broad novelty-shirt Best Sellers category.
if (BEST_SELLER_PRESETS?.US) {
  const preset = {
    label: 'Amazon Merch Designs',
    url: AMAZON_MERCH_URL,
    sourceType: 'amazon-merch-browse',
    browseNode: AMAZON_MERCH_NODE
  };

  BEST_SELLER_PRESETS.US.tshirt = preset;
  BEST_SELLER_PRESETS.US.hoodie = preset;
  BEST_SELLER_PRESETS.US.sweatshirt = preset;
  BEST_SELLER_PRESETS.US.tank = preset;
  BEST_SELLER_PRESETS.US.all = preset;
  delete BEST_SELLER_PRESETS.US.clothing;
}

const originalRefreshBestSellers = ZeroPODBuiltInProvider.prototype.refreshBestSellers;

async function collectMerchBrowseItems(page) {
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight || 0)).catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

  return page.evaluate(() => {
    const productHref = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;
    const anchors = [...document.querySelectorAll('a[href]')].filter((anchor) => productHref.test(anchor.getAttribute('href') || ''));
    const seen = new Set();
    const items = [];

    const usefulText = (value) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (text.length < 4) return '';
      if (/^(?:see more|shop now|learn more|amazon|prime)$/i.test(text)) return '';
      return text;
    };

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute('href') || '';
      const match = rawHref.match(productHref);
      const asin = match?.[1]?.toUpperCase();
      if (!asin || seen.has(asin)) continue;

      const card = anchor.closest('[data-asin], [data-component-type="s-search-result"], .s-result-item, li, article') || anchor.parentElement?.parentElement || anchor.parentElement;
      const image = card?.querySelector?.('img') || anchor.querySelector?.('img') || null;
      const heading = card?.querySelector?.('h2, h3, [class*="title" i]') || null;
      const title = usefulText(image?.getAttribute('alt')) || usefulText(heading?.textContent) || usefulText(anchor.textContent);
      if (!title) continue;

      const price = card?.querySelector?.('.a-price .a-offscreen, [class*="price"] .a-offscreen, .a-price')?.textContent?.trim() || null;
      const ratingNode = card?.querySelector?.('[aria-label*="out of 5" i], [title*="out of 5" i]') || null;
      const ratingText = ratingNode?.getAttribute('aria-label') || ratingNode?.getAttribute('title') || null;
      const reviewNode = [...(card?.querySelectorAll?.('a, span') || [])].find((node) => {
        const text = String(node.textContent || '').trim();
        return /^\(?[\d,]+\)?$/.test(text) && /review|rating/i.test(`${node.getAttribute?.('aria-label') || ''} ${node.parentElement?.textContent || ''}`);
      });

      seen.add(asin);
      items.push({
        asin,
        title,
        href: anchor.href || rawHref,
        imageUrl: image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || null,
        price,
        ratingText,
        reviewsText: reviewNode?.textContent?.trim() || null,
        sourcePosition: items.length + 1
      });
      if (items.length >= 80) break;
    }

    return {
      heading: document.querySelector('h1, h2')?.textContent?.replace(/\s+/g, ' ').trim() || document.title,
      items
    };
  });
}

ZeroPODBuiltInProvider.prototype.refreshBestSellers = async function refreshPodSource(payload = {}) {
  const marketplace = String(payload.marketplace || 'US').toUpperCase();
  const productType = String(payload.productType || 'tshirt').toLowerCase();
  const preset = this.getPreset(marketplace, productType);
  const requestedUrl = payload.sourceUrl || preset?.url;

  if (marketplace !== 'US' || !isTrustedMerchBrowseUrl(requestedUrl)) {
    return originalRefreshBestSellers.call(this, payload);
  }

  const { page } = await this.ensurePage('US', AMAZON_MERCH_URL);
  const pageInfo = await collectMerchBrowseItems(page);
  const now = new Date().toISOString();

  const candidates = [];
  for (const item of pageInfo.items) {
    const detectedType = classifyProduct(item.title);
    if (!['tshirt', 'hoodie', 'sweatshirt', 'tank'].includes(detectedType)) continue;
    if (productType !== 'all' && detectedType !== productType) continue;
    candidates.push({
      ...item,
      detectedType,
      canonicalUrl: canonicalAmazonUrl('US', item.asin),
      previous: this.store.get(`US:${item.asin}`)
    });
  }

  const enriched = await mapWithConcurrency(candidates, BSR_CONCURRENCY, async (item) => ({
    ...item,
    bsrData: await fetchBsr(this, item, item.previous)
  }));

  const results = [];
  for (const item of enriched) {
    const cachedImagePath = await this.downloadImage(item.imageUrl, 'US', item.asin);
    const previous = item.previous;
    const product = {
      ...(previous || {}),
      marketplace: 'US',
      asin: item.asin,
      canonicalUrl: item.canonicalUrl,
      title: item.title,
      imageUrl: item.imageUrl,
      cachedImagePath,
      productType: item.detectedType,
      category: 'Amazon Merch Designs',
      verifiedBestSeller: false,
      bestSellerPosition: null,
      bestSellerCategory: null,
      bestSellerSourceUrl: null,
      bestSellerBrowseNode: null,
      merchBrowseNode: AMAZON_MERCH_NODE,
      merchBrowseSourceUrl: AMAZON_MERCH_URL,
      merchBrowseVerified: true,
      merchOnDemandVerified: true,
      merchOnDemandEvidence: `Amazon Merch Designs browse node ${AMAZON_MERCH_NODE}`,
      merchOnDemandReason: 'amazon-merch-browse-node',
      merchOnDemandCheckedAt: now,
      merchVerificationVersion: MERCH_VERIFICATION_VERSION,
      podVerificationKind: 'amazon-merch-browse-node',
      sourcePosition: item.sourcePosition,
      bsr: item.bsrData.bsr,
      bsrCategory: item.bsrData.bsrCategory,
      allBsr: item.bsrData.allBsr,
      bsrCheckedAt: item.bsrData.bsrCheckedAt,
      bsrStatus: item.bsrData.bsrStatus,
      price: item.price,
      rating: numberFromText(item.ratingText),
      reviewCount: numberFromText(item.reviewsText),
      lastCheckedAt: now,
      lastVerifiedAt: now,
      source: 'amazon-merch-browse'
    };

    product.winnerScore = calculateWinnerScore({ ...product, history: previous?.history || [] });
    results.push(this.store.upsert(product, {
      contextKey: `amazon-merch-browse:US:${productType}`,
      marketplace: 'US',
      productType,
      sourceUrl: AMAZON_MERCH_URL,
      sourceType: 'amazon-merch-browse',
      browseNode: AMAZON_MERCH_NODE
    }));
  }

  const rankedCount = results.filter((item) => Number.isFinite(Number(item.bsr))).length;
  return {
    marketplace: 'US',
    productType,
    sourceUrl: AMAZON_MERCH_URL,
    sourceType: 'amazon-merch-browse',
    browseNode: AMAZON_MERCH_NODE,
    category: 'Amazon Merch Designs',
    verifiedAt: now,
    count: results.length,
    sourceCount: pageInfo.items.length,
    rankedCount,
    items: results
  };
};

module.exports = {
  AMAZON_MERCH_NODE,
  AMAZON_MERCH_URL,
  isTrustedMerchBrowseUrl,
  extractBsrFromHtml
};
