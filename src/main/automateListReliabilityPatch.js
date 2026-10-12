const fs = require('fs');
const path = require('path');
const { AutomateListFeature } = require('./automateListFeature');
const { extractAsin, marketplaceFromUrl } = require('./researchProvider');

const MAX_FETCH_ATTEMPTS = 3;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isHumanGate(message) {
  return /captcha|robot check|human verification|make sure you're not a robot|sign-in|sign in|requires sign/i.test(String(message || ''));
}

function isAmazonHost(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
    return /^(?:amazon\.(?:com|de|fr|it|es)|amazon\.co\.uk)$/.test(host);
  } catch {
    return false;
  }
}

function canonicalProductUrl(value, asin) {
  const url = new URL(String(value));
  return `${url.protocol}//${url.host}/dp/${String(asin).toUpperCase()}`;
}

function imageExtension(imageUrl) {
  try {
    const pathname = new URL(String(imageUrl)).pathname.toLowerCase();
    if (pathname.endsWith('.png')) return '.png';
    if (pathname.endsWith('.webp')) return '.webp';
  } catch {}
  return '.jpg';
}

function validCachedFile(file) {
  try { return Boolean(file && fs.existsSync(file) && fs.statSync(file).size >= 1000); }
  catch { return false; }
}

async function readAmazonDetail(page) {
  return page.evaluate(() => {
    const body = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const candidates = [];
    let jsonLdTitle = null;

    const addImage = (url, score = 1) => {
      const value = String(url || '').trim();
      if (!/^https?:\/\//i.test(value)) return;
      if (/sprite|logo|transparent-pixel|spacer|grey-pixel/i.test(value)) return;
      if (!candidates.some((item) => item.url === value)) candidates.push({ url: value, score });
    };

    const selectors = [
      '#landingImage',
      '#imgBlkFront',
      '#main-image',
      '#imgTagWrapperId img',
      '#main-image-container img',
      '#imageBlock_feature_div img',
      '[data-feature-name="imageBlock"] img',
      'img.a-dynamic-image'
    ];

    for (const selector of selectors) {
      for (const image of document.querySelectorAll(selector)) {
        addImage(image.getAttribute('data-old-hires'), 120);
        addImage(image.getAttribute('data-a-hires'), 115);
        addImage(image.currentSrc, 90);
        addImage(image.src, 80);
        const dynamic = image.getAttribute('data-a-dynamic-image');
        if (dynamic) {
          try {
            const parsed = JSON.parse(dynamic);
            for (const [url, size] of Object.entries(parsed)) {
              const area = Array.isArray(size) ? Number(size[0] || 0) * Number(size[1] || 0) : 0;
              addImage(url, 100 + Math.min(50, area / 100000));
            }
          } catch {}
        }
      }
    }

    addImage(document.querySelector('meta[property="og:image"]')?.content, 85);
    addImage(document.querySelector('link[rel="image_src"]')?.href, 75);

    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(node.textContent || 'null');
        const stack = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of stack) {
          if (!item || typeof item !== 'object') continue;
          const objects = Array.isArray(item['@graph']) ? item['@graph'] : [item];
          for (const object of objects) {
            if (!object || typeof object !== 'object') continue;
            if (!jsonLdTitle && object.name) jsonLdTitle = String(object.name).trim();
            const images = Array.isArray(object.image) ? object.image : [object.image];
            for (const image of images) {
              if (typeof image === 'string') addImage(image, 95);
              else if (image && typeof image === 'object') addImage(image.url || image.contentUrl, 95);
            }
          }
        }
      } catch {}
    }

    const titleCandidates = [
      document.querySelector('#productTitle')?.textContent,
      document.querySelector('#title span')?.textContent,
      document.querySelector('h1#title')?.textContent,
      document.querySelector('[data-feature-name="title"] h1')?.textContent,
      document.querySelector('meta[property="og:title"]')?.content,
      jsonLdTitle,
      document.title
    ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

    const genericTitle = /^(amazon\.com|amazon|sorry|page not found)/i;
    const title = titleCandidates.find((value) => !genericTitle.test(value)) || titleCandidates[0] || null;
    candidates.sort((a, b) => b.score - a.score);

    const dead = /sorry[, ]+we couldn['’]t find that page|page not found|the web address you entered is not a functioning page|looking for something\?/i.test(body);
    const challenge = /robot check|enter the characters you see below|sorry, we just need to make sure you're not a robot|captcha/i.test(`${document.title}\n${body}`);
    return {
      title,
      imageUrl: candidates[0]?.url || null,
      imageCandidates: candidates.slice(0, 8).map((item) => item.url),
      dead,
      challenge,
      href: location.href
    };
  });
}

async function downloadWithBrowserRequest(context, store, imageUrl, marketplace, asin) {
  if (!context?.request || !imageUrl) return null;
  try {
    const response = await context.request.get(String(imageUrl), {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://www.amazon.com/'
      }
    });
    if (!response.ok()) return null;
    const buffer = await response.body();
    if (!buffer || buffer.length < 1000) return null;
    const dir = store.getCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${String(marketplace).toUpperCase()}_${String(asin).toUpperCase()}_browser${imageExtension(imageUrl)}`);
    fs.writeFileSync(target, buffer);
    return target;
  } catch {
    return null;
  }
}

async function screenshotProductImage(page, store, marketplace, asin) {
  const selectors = [
    '#landingImage',
    '#imgBlkFront',
    '#main-image',
    '#imgTagWrapperId img',
    '#main-image-container img',
    '#imageBlock_feature_div img',
    '[data-feature-name="imageBlock"] img',
    'img.a-dynamic-image'
  ];
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.count()) || !(await locator.isVisible({ timeout: 1200 }).catch(() => false))) continue;
      const dir = store.getCacheDir();
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `${String(marketplace).toUpperCase()}_${String(asin).toUpperCase()}_screenshot.png`);
      await locator.screenshot({ path: target, timeout: 10000 });
      if (validCachedFile(target)) return target;
    } catch {}
  }
  return null;
}

AutomateListFeature.prototype.fetchAmazonProduct = async function fetchAmazonProductReliable(item) {
  const asin = extractAsin(item.url);
  const marketplace = marketplaceFromUrl(item.url);
  if (!isAmazonHost(item.url) || !asin || !marketplace) {
    const error = new Error('Invalid or unsupported Amazon product link.');
    error.code = 'INVALID_LINK';
    throw error;
  }

  const canonicalUrl = canonicalProductUrl(item.url, asin);
  const targets = [item.url, canonicalUrl, canonicalUrl];
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const targetUrl = targets[attempt - 1];
    this.store.updateItem(item.id, {
      status: 'checking',
      attempts: attempt,
      reason: attempt === 1
        ? `Checking Amazon · attempt ${attempt}/${MAX_FETCH_ATTEMPTS}`
        : `Retrying Amazon · attempt ${attempt}/${MAX_FETCH_ATTEMPTS}`
    });

    try {
      const { context, page } = await this.provider.ensurePage(marketplace, targetUrl);

      if (attempt === 2) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await this.provider.assertHumanAccess(page);
      } else if (attempt === 3 && page.url() !== canonicalUrl) {
        await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await this.provider.assertHumanAccess(page);
      }

      await page.waitForSelector('#productTitle, #title, #landingImage, #imgTagWrapperId img, #main-image-container img, img.a-dynamic-image', { timeout: 6500 }).catch(() => {});
      await page.waitForTimeout(1000 + attempt * 600);
      await this.provider.assertHumanAccess(page);

      const detail = await readAmazonDetail(page);
      if (detail.challenge) throw new Error('Amazon is showing a CAPTCHA / robot check. Complete the normal browser challenge, then resume.');
      if (detail.dead) {
        lastError = new Error('Amazon returned its page-not-found screen.');
        lastError.code = 'DEAD_LINK';
        if (attempt < MAX_FETCH_ATTEMPTS) { await wait(900 * attempt); continue; }
        throw lastError;
      }
      if (!detail.title || !detail.imageUrl) {
        lastError = new Error(`Amazon page loaded but ${!detail.title && !detail.imageUrl ? 'title and product image were' : !detail.title ? 'title was' : 'product image was'} not detected.`);
        lastError.code = 'RETRYABLE_AMAZON';
        if (attempt < MAX_FETCH_ATTEMPTS) { await wait(1000 * attempt); continue; }
        throw lastError;
      }

      const imageUrls = [detail.imageUrl, ...(detail.imageCandidates || [])].filter((value, index, array) => value && array.indexOf(value) === index);
      let cachedImagePath = null;
      for (const imageUrl of imageUrls) {
        cachedImagePath = await this.provider.downloadImage(imageUrl, marketplace, asin);
        if (validCachedFile(cachedImagePath)) break;
        cachedImagePath = await downloadWithBrowserRequest(context, this.researchStore, imageUrl, marketplace, asin);
        if (validCachedFile(cachedImagePath)) break;
      }

      if (!validCachedFile(cachedImagePath)) {
        cachedImagePath = await screenshotProductImage(page, this.researchStore, marketplace, asin);
      }

      if (!validCachedFile(cachedImagePath)) {
        lastError = new Error('Amazon product page was found, but the product image could not be captured.');
        lastError.code = 'RETRYABLE_AMAZON';
        if (attempt < MAX_FETCH_ATTEMPTS) { await wait(1000 * attempt); continue; }
        throw lastError;
      }

      return {
        asin,
        marketplace,
        title: detail.title,
        cachedImagePath,
        attempts: attempt,
        resolvedUrl: detail.href || targetUrl,
        usedCanonicalFallback: targetUrl === canonicalUrl && targetUrl !== item.url
      };
    } catch (error) {
      const message = error?.message || String(error);
      if (isHumanGate(message)) throw error;
      lastError = error;
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await wait(1000 * attempt);
        continue;
      }
    }
  }

  const finalError = new Error(lastError?.message || `Amazon could not be read after ${MAX_FETCH_ATTEMPTS} attempts.`);
  finalError.code = lastError?.code || 'RETRYABLE_AMAZON';
  finalError.attempts = MAX_FETCH_ATTEMPTS;
  throw finalError;
};

const originalProcessItem = AutomateListFeature.prototype.processItem;
AutomateListFeature.prototype.processItem = async function processItemWithRetryState(item) {
  try {
    await originalProcessItem.call(this, item);
  } finally {
    const current = this.store.read().items.find((entry) => entry.id === item.id);
    if (!current) return;
    if (current.status === 'skipped') {
      const reason = String(current.reason || '');
      const retryable = !/invalid or unsupported|already exists in Automation/i.test(reason);
      if (current.retryable !== retryable) this.store.updateItem(item.id, { retryable });
    }
    if (current.status === 'added' && current.attempts > 1) {
      this.store.updateItem(item.id, {
        reason: `Image + Amazon link sent to Automation after ${current.attempts} attempts.`,
        retryable: false
      });
    }
  }
};

AutomateListFeature.prototype.retrySkipped = function retrySkipped() {
  const data = this.store.read();
  if (['running', 'waiting-space'].includes(data.state)) throw new Error('Pause or stop Automate List before retrying skipped links.');
  let retried = 0;
  data.items = data.items.map((item) => {
    if (item.status !== 'skipped' || item.retryable === false) return item;
    retried += 1;
    return {
      ...item,
      status: 'pending',
      reason: 'Queued for another Amazon retry.',
      attempts: 0,
      retryable: true,
      updatedAt: new Date().toISOString()
    };
  });
  if (!retried) throw new Error('There are no retryable skipped Amazon links.');
  this.stopRequested = true;
  this.store.write({
    ...data,
    state: 'stopped',
    lastMessage: `Queued ${retried} skipped Amazon link${retried === 1 ? '' : 's'} for retry.`
  });
  return this.snapshot();
};

module.exports = { MAX_FETCH_ATTEMPTS };
