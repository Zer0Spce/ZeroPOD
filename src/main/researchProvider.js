const fs = require('fs');
const path = require('path');
const { SERVICES } = require('./sessionManager');

const MARKETPLACES = {
  US: { label: 'United States', domain: 'www.amazon.com', baseUrl: 'https://www.amazon.com', currency: 'USD' },
  UK: { label: 'United Kingdom', domain: 'www.amazon.co.uk', baseUrl: 'https://www.amazon.co.uk', currency: 'GBP' },
  DE: { label: 'Germany', domain: 'www.amazon.de', baseUrl: 'https://www.amazon.de', currency: 'EUR' },
  FR: { label: 'France', domain: 'www.amazon.fr', baseUrl: 'https://www.amazon.fr', currency: 'EUR' },
  IT: { label: 'Italy', domain: 'www.amazon.it', baseUrl: 'https://www.amazon.it', currency: 'EUR' },
  ES: { label: 'Spain', domain: 'www.amazon.es', baseUrl: 'https://www.amazon.es', currency: 'EUR' }
};

// v1 intentionally starts with one conservative, known US T-shirt Best Sellers node.
// Other marketplaces can still be researched through a user-supplied Amazon Best Sellers URL
// and manual ASIN/product import without ever pretending search position is Best Seller position.
const BEST_SELLER_PRESETS = {
  US: {
    tshirt: { label: 'T-Shirts', url: 'https://www.amazon.com/gp/bestsellers/fashion/1045624' },
    clothing: { label: 'Clothing, Shoes & Jewelry', url: 'https://www.amazon.com/gp/bestsellers/fashion/' }
  }
};

if (!SERVICES.amazonResearch) {
  SERVICES.amazonResearch = {
    name: 'Amazon Research',
    url: 'https://www.amazon.com/Best-Sellers/zgbs',
    loginUrlPatterns: [/\/ap\/signin/i, /\/signin/i],
    loggedOutText: [/^sign in$/i],
    authenticatedSelectors: ['#nav-link-accountList', '#nav-logo-sprites', '#nav-bb-logo']
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeMarketplace(value = 'US') {
  const code = String(value || 'US').trim().toUpperCase();
  if (!MARKETPLACES[code]) throw new Error(`Unsupported Amazon marketplace: ${value}`);
  return code;
}

function extractAsin(value) {
  const raw = String(value || '').trim();
  const direct = raw.match(/^[A-Z0-9]{10}$/i);
  if (direct) return direct[0].toUpperCase();
  const match = raw.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function marketplaceFromUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return Object.entries(MARKETPLACES).find(([, item]) => host === item.domain || host === item.domain.replace(/^www\./, ''))?.[0] || null;
  } catch { return null; }
}

function canonicalAmazonUrl(marketplace, asin) {
  const code = normalizeMarketplace(marketplace);
  if (!asin) throw new Error('ASIN is required to build an Amazon URL.');
  return `${MARKETPLACES[code].baseUrl}/dp/${String(asin).toUpperCase()}`;
}

function classifyProduct(title = '') {
  const text = String(title).toLowerCase();
  if (/hoodie|hooded sweatshirt/.test(text)) return 'hoodie';
  if (/sweatshirt|crewneck/.test(text)) return 'sweatshirt';
  if (/tank top|tanktop|racerback/.test(text)) return 'tank';
  if (/t-?shirt|tee\b|graphic shirt|novelty shirt/.test(text)) return 'tshirt';
  return 'other';
}

function numberFromText(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/\u00a0/g, ' ').match(/([\d,.]+)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function computeTrend(history = [], field, days = 7) {
  const cutoff = Date.now() - days * 86400000;
  const points = history
    .filter((entry) => new Date(entry.at || 0).getTime() >= cutoff && Number.isFinite(Number(entry[field])))
    .map((entry) => ({ at: new Date(entry.at).getTime(), value: Number(entry[field]) }))
    .sort((a, b) => a.at - b.at);
  if (points.length < 2) return null;
  const oldValue = points[0].value;
  const newValue = points[points.length - 1].value;
  if (!oldValue) return null;
  return { from: oldValue, to: newValue, improvementPercent: ((oldValue - newValue) / oldValue) * 100, points: points.length };
}

function calculateWinnerScore(product) {
  const factors = [];
  if (product.verifiedBestSeller) factors.push({ weight: 30, score: 1 });
  if (Number.isFinite(product.bestSellerPosition)) factors.push({ weight: 25, score: Math.max(0, Math.min(1, (101 - product.bestSellerPosition) / 100)) });
  if (Number.isFinite(product.bsr)) factors.push({ weight: 15, score: Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, product.bsr)) / 7)) });
  if (Number.isFinite(product.reviewCount)) factors.push({ weight: 10, score: product.reviewCount <= 25 ? 1 : product.reviewCount <= 100 ? 0.7 : product.reviewCount <= 500 ? 0.35 : 0.1 });
  if (Number.isFinite(product.rating)) factors.push({ weight: 5, score: Math.max(0, Math.min(1, product.rating / 5)) });
  if (product.firstSeenAt) {
    const ageDays = Math.max(0, (Date.now() - new Date(product.firstSeenAt).getTime()) / 86400000);
    factors.push({ weight: 5, score: ageDays <= 30 ? 1 : ageDays <= 90 ? 0.7 : ageDays <= 180 ? 0.35 : 0.15 });
  }
  const trend = computeTrend(product.history || [], 'bsr', 7) || computeTrend(product.history || [], 'bestSellerPosition', 7);
  if (trend) factors.push({ weight: 10, score: Math.max(0, Math.min(1, trend.improvementPercent / 75)) });
  const availableWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  if (availableWeight < 30) return { score: null, label: 'N/A', confidence: 'low' };
  const weighted = factors.reduce((sum, item) => sum + item.weight * item.score, 0);
  const score = Math.round((weighted / availableWeight) * 100);
  const label = score >= 90 ? 'HOT WINNER' : score >= 80 ? 'STRONG OPPORTUNITY' : score >= 70 ? 'PROMISING' : 'NORMAL';
  return { score, label, confidence: availableWeight >= 70 ? 'high' : availableWeight >= 50 ? 'medium' : 'low' };
}

class ZeroPODBuiltInProvider {
  constructor({ sessions, store }) {
    this.sessions = sessions;
    this.store = store;
  }

  getPreset(marketplace, productType) {
    return BEST_SELLER_PRESETS[normalizeMarketplace(marketplace)]?.[productType] || null;
  }

  async ensurePage(marketplace, url) {
    const code = normalizeMarketplace(marketplace);
    const { context, page } = await this.sessions.ensureService('amazonResearch');
    const target = url || MARKETPLACES[code].baseUrl;
    if (!page.url().startsWith(MARKETPLACES[code].baseUrl) || (url && page.url() !== url)) {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    await page.waitForTimeout(900);
    await this.assertHumanAccess(page);
    return { context, page };
  }

  async assertHumanAccess(page) {
    const title = await page.title().catch(() => '');
    const body = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');
    if (/robot check|enter the characters you see below|sorry, we just need to make sure you're not a robot|captcha/i.test(`${title}\n${body}`)) {
      throw new Error('Amazon is showing a CAPTCHA / robot check. ZeroPOD will not bypass it. Open Connections → Amazon Research, complete the normal browser challenge, then retry Refresh.');
    }
    if (/sign-in|ap\/signin/i.test(page.url())) {
      throw new Error('Amazon requires sign-in. Open Connections → Amazon Research, sign in normally, then retry.');
    }
  }

  async downloadImage(imageUrl, marketplace, asin) {
    if (!imageUrl) return null;
    const cacheDir = this.store.getCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    const cleanUrl = String(imageUrl).replace(/\._[^.]+_\./, '.');
    const ext = /\.png(?:[?#]|$)/i.test(cleanUrl) ? '.png' : /\.webp(?:[?#]|$)/i.test(cleanUrl) ? '.webp' : '.jpg';
    const target = path.join(cacheDir, `${normalizeMarketplace(marketplace)}_${String(asin).toUpperCase()}${ext}`);
    if (fs.existsSync(target) && fs.statSync(target).size > 1000) return target;
    try {
      const response = await fetch(cleanUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1000) return null;
      fs.writeFileSync(target, buffer);
      return target;
    } catch { return null; }
  }

  async refreshBestSellers({ marketplace = 'US', productType = 'tshirt', sourceUrl = null } = {}) {
    const code = normalizeMarketplace(marketplace);
    const preset = this.getPreset(code, productType);
    const url = sourceUrl || preset?.url;
    if (!url) throw new Error(`No built-in Best Sellers source is configured yet for ${MARKETPLACES[code].label} / ${productType}. Paste an Amazon Best Sellers category URL or use manual Amazon import.`);
    const parsedMarketplace = marketplaceFromUrl(url);
    if (parsedMarketplace && parsedMarketplace !== code) throw new Error(`The Best Sellers URL belongs to Amazon ${parsedMarketplace}, but ${code} is selected.`);
    if (!/\/(?:Best-Sellers|best-sellers|gp\/bestsellers|zgbs)(?:[/?]|$)/i.test(url)) {
      throw new Error('Verified Best Seller refresh requires an actual Amazon Best Sellers ranking/category URL. Search result pages are intentionally not accepted as Best Seller proof.');
    }

    const { page } = await this.ensurePage(code, url);
    const pageInfo = await page.evaluate(() => {
      const heading = document.querySelector('h1, h2')?.textContent?.trim() || document.title;
      const category = heading.replace(/^Amazon Best Sellers:?\s*/i, '').replace(/^Best Sellers in\s*/i, '').trim();
      const cards = [...document.querySelectorAll('[id^="gridItemRoot"], .zg-grid-general-faceout, .p13n-sc-uncoverable-faceout')];
      const seen = new Set();
      const items = [];
      for (const card of cards) {
        const anchor = [...card.querySelectorAll('a[href]')].find((a) => /\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(a.getAttribute('href') || ''));
        if (!anchor) continue;
        const href = anchor.href || anchor.getAttribute('href') || '';
        const asin = (href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
        if (!asin || seen.has(asin)) continue;
        seen.add(asin);
        const image = card.querySelector('img');
        const rankText = card.querySelector('.zg-bdg-text, [class*="zg-bdg"]')?.textContent || card.textContent || '';
        const rankMatch = rankText.match(/#\s*(\d{1,4})/);
        const ratingEl = card.querySelector('[aria-label*="out of 5" i], [title*="out of 5" i]');
        const reviewEl = [...card.querySelectorAll('a, span')].find((el) => /^\s*[\d,]+\s*$/.test(el.textContent || '') && /review|rating/i.test(`${el.getAttribute('aria-label') || ''} ${el.parentElement?.textContent || ''}`));
        const priceEl = card.querySelector('.p13n-sc-price, .a-price .a-offscreen, [class*="price"]');
        const title = (image?.getAttribute('alt') || anchor.textContent || card.querySelector('a span')?.textContent || '').trim();
        items.push({ asin: asin.toUpperCase(), href, title, imageUrl: image?.currentSrc || image?.src || null, rank: rankMatch ? Number(rankMatch[1]) : null, price: priceEl?.textContent?.trim() || null, ratingText: ratingEl?.getAttribute('aria-label') || ratingEl?.getAttribute('title') || null, reviewsText: reviewEl?.textContent?.trim() || null });
      }
      return { category: category || null, title: document.title, items };
    });

    const now = new Date().toISOString();
    const results = [];
    for (const item of pageInfo.items) {
      if (!Number.isFinite(item.rank)) continue; // exact ranking is required for verification
      const canonicalUrl = canonicalAmazonUrl(code, item.asin);
      const cachedImagePath = await this.downloadImage(item.imageUrl, code, item.asin);
      const product = {
        marketplace: code,
        asin: item.asin,
        canonicalUrl,
        title: item.title || `Amazon ${item.asin}`,
        imageUrl: item.imageUrl,
        cachedImagePath,
        productType: classifyProduct(item.title),
        category: pageInfo.category || preset?.label || null,
        verifiedBestSeller: true,
        bestSellerPosition: item.rank,
        bestSellerCategory: pageInfo.category || preset?.label || null,
        bestSellerSourceUrl: url,
        bestSellerBrowseNode: (url.match(/\/([0-9]{4,})(?:[/?]|$)/) || [])[1] || null,
        price: item.price,
        rating: numberFromText(item.ratingText),
        reviewCount: numberFromText(item.reviewsText),
        lastCheckedAt: now,
        lastVerifiedAt: now,
        source: 'amazon-best-sellers'
      };
      const previous = this.store.get(`${code}:${item.asin}`);
      const withHistory = { ...previous, ...product, history: previous?.history || [] };
      product.winnerScore = calculateWinnerScore(withHistory);
      results.push(this.store.upsert(product, { contextKey: `best-sellers:${code}:${productType}`, marketplace: code, productType, sourceUrl: url, sourceType: 'amazon-best-sellers' }));
      await wait(35);
    }
    return { marketplace: code, productType, sourceUrl: url, category: pageInfo.category || preset?.label || null, verifiedAt: now, count: results.length, items: results };
  }

  async importProduct(value, marketplaceHint = null) {
    const asin = extractAsin(value);
    if (!asin) throw new Error('Enter a valid Amazon product URL or 10-character ASIN.');
    const marketplace = marketplaceFromUrl(value) || normalizeMarketplace(marketplaceHint || 'US');
    const url = canonicalAmazonUrl(marketplace, asin);
    const { page } = await this.ensurePage(marketplace, url);

    const detail = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const title = document.querySelector('#productTitle')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || document.title;
      const image = document.querySelector('#landingImage, #imgBlkFront, #main-image') || document.querySelector('img[data-old-hires], img[src*="images-amazon"]');
      const price = document.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice')?.textContent?.trim() || null;
      const rating = document.querySelector('#acrPopover')?.getAttribute('title') || document.querySelector('#acrPopover')?.getAttribute('aria-label') || null;
      const reviews = document.querySelector('#acrCustomerReviewText')?.textContent?.trim() || null;
      const availability = document.querySelector('#availability')?.textContent?.trim() || null;
      const rankSection = [...document.querySelectorAll('#detailBullets_feature_div, #productDetails_detailBullets_sections1, #productDetails_db_sections, table, ul')].map((el) => el.innerText || '').join('\n');
      const bsrMatches = [...rankSection.matchAll(/#\s*([\d,]+)\s+in\s+([^\n(]+)/gi)].map((m) => ({ rank: m[1], category: m[2].trim() }));
      const dateMatch = text.match(/Date First Available\s*[:\n]\s*([^\n]+)/i);
      return { title, imageUrl: image?.currentSrc || image?.src || image?.getAttribute('data-old-hires') || null, price, rating, reviews, availability, bsrMatches, dateFirstAvailable: dateMatch ? dateMatch[1].trim() : null };
    });

    const cachedImagePath = await this.downloadImage(detail.imageUrl, marketplace, asin);
    const firstRank = detail.bsrMatches?.[0] || null;
    const previous = this.store.get(`${marketplace}:${asin}`);
    const product = {
      marketplace,
      asin,
      canonicalUrl: url,
      title: detail.title || `Amazon ${asin}`,
      imageUrl: detail.imageUrl,
      cachedImagePath,
      productType: classifyProduct(detail.title),
      category: previous?.category || null,
      verifiedBestSeller: Boolean(previous?.verifiedBestSeller),
      bestSellerPosition: previous?.bestSellerPosition ?? null,
      bestSellerCategory: previous?.bestSellerCategory || null,
      bestSellerSourceUrl: previous?.bestSellerSourceUrl || null,
      bsr: firstRank ? numberFromText(firstRank.rank) : null,
      bsrCategory: firstRank?.category || null,
      allBsr: (detail.bsrMatches || []).map((item) => ({ rank: numberFromText(item.rank), category: item.category })),
      price: detail.price,
      rating: numberFromText(detail.rating),
      reviewCount: numberFromText(detail.reviews),
      availability: detail.availability,
      dateFirstAvailable: detail.dateFirstAvailable,
      lastCheckedAt: new Date().toISOString(),
      source: 'manual-amazon-import'
    };
    product.winnerScore = calculateWinnerScore({ ...previous, ...product, history: previous?.history || [] });
    return this.store.upsert(product, { contextKey: `manual:${marketplace}`, marketplace, sourceUrl: url, sourceType: 'manual-import' });
  }
}

module.exports = { ZeroPODBuiltInProvider, MARKETPLACES, BEST_SELLER_PRESETS, extractAsin, marketplaceFromUrl, canonicalAmazonUrl, classifyProduct, calculateWinnerScore, computeTrend };
