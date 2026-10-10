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

  // Broad Clothing, Shoes & Jewelry is intentionally not exposed as a POD source.
  delete BEST_SELLER_PRESETS.US.clothing;
}

const originalRefreshBestSellers = ZeroPODBuiltInProvider.prototype.refreshBestSellers;

async function collectMerchBrowseItems(page) {
  // Let Amazon lazy-load the design grid without turning this into a long-running crawl.
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

  // Custom genuine Best Sellers URLs keep using the original proven Best Seller flow.
  if (marketplace !== 'US' || !isTrustedMerchBrowseUrl(requestedUrl)) {
    return originalRefreshBestSellers.call(this, payload);
  }

  const { page } = await this.ensurePage('US', AMAZON_MERCH_URL);
  const pageInfo = await collectMerchBrowseItems(page);
  const now = new Date().toISOString();
  const results = [];

  for (const item of pageInfo.items) {
    const detectedType = classifyProduct(item.title);
    if (!['tshirt', 'hoodie', 'sweatshirt', 'tank'].includes(detectedType)) continue;
    if (productType !== 'all' && detectedType !== productType) continue;

    const canonicalUrl = canonicalAmazonUrl('US', item.asin);
    const cachedImagePath = await this.downloadImage(item.imageUrl, 'US', item.asin);
    const previous = this.store.get(`US:${item.asin}`);
    const product = {
      ...(previous || {}),
      marketplace: 'US',
      asin: item.asin,
      canonicalUrl,
      title: item.title,
      imageUrl: item.imageUrl,
      cachedImagePath,
      productType: detectedType,
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
    items: results
  };
};

module.exports = { AMAZON_MERCH_NODE, AMAZON_MERCH_URL, isTrustedMerchBrowseUrl };
