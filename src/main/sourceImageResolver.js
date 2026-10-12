const { app } = require('electron');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAmazonUrl(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
    return /^(?:amazon\.(?:com|de|fr|it|es)|amazon\.co\.uk)$/.test(host);
  } catch {
    return false;
  }
}

function extractAsin(value) {
  const match = String(value || '').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function canonicalAmazonUrl(value) {
  try {
    const url = new URL(String(value));
    const asin = extractAsin(value);
    return asin ? `${url.protocol}//${url.host}/dp/${asin}` : null;
  } catch {
    return null;
  }
}

class SourceImageResolver {
  constructor() {
    this.contextPromise = null;
  }

  getCacheDir() {
    return path.join(app.getPath('userData'), 'source-image-cache');
  }

  getIndexPath() {
    return path.join(this.getCacheDir(), 'index.json');
  }

  readIndex() {
    try {
      const file = this.getIndexPath();
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    } catch {
      return {};
    }
  }

  writeIndex(index) {
    fs.mkdirSync(this.getCacheDir(), { recursive: true });
    fs.writeFileSync(this.getIndexPath(), JSON.stringify(index, null, 2), 'utf8');
  }

  validCachedPath(file) {
    try {
      return Boolean(file && fs.existsSync(file) && fs.statSync(file).size >= 4096);
    } catch {
      return false;
    }
  }

  cachedFor(sourceUrl) {
    const index = this.readIndex();
    const entry = index[String(sourceUrl || '')];
    return this.validCachedPath(entry?.path) ? entry : null;
  }

  remember(sourceUrl, result) {
    const index = this.readIndex();
    index[String(sourceUrl || '')] = {
      path: result.path,
      title: result.title || null,
      imageUrl: result.imageUrl || null,
      resolvedUrl: result.resolvedUrl || String(sourceUrl || ''),
      savedAt: new Date().toISOString()
    };
    this.writeIndex(index);
  }

  async ensureContext() {
    if (this.contextPromise) return this.contextPromise;
    const profile = path.join(app.getPath('userData'), 'profiles', 'source-image-fetch');
    fs.mkdirSync(profile, { recursive: true });
    this.contextPromise = chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: false
    }).then((context) => {
      context.on('close', () => { this.contextPromise = null; });
      return context;
    }).catch((error) => {
      this.contextPromise = null;
      throw error;
    });
    return this.contextPromise;
  }

  async validateBuffer(buffer) {
    if (!buffer || buffer.length < 4096) throw new Error('Fetched image was unexpectedly small.');
    const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 220 || metadata.height < 220) {
      throw new Error(`Fetched image dimensions are too small (${metadata.width || 0}×${metadata.height || 0}).`);
    }
    return metadata;
  }

  extensionFor(metadata) {
    if (metadata.format === 'png') return '.png';
    if (metadata.format === 'webp') return '.webp';
    return '.jpg';
  }

  async saveBuffer(buffer, sourceUrl, imageUrl) {
    const metadata = await this.validateBuffer(buffer);
    const key = crypto.createHash('sha1').update(`${sourceUrl}\n${imageUrl || ''}`).digest('hex').slice(0, 20);
    const target = path.join(this.getCacheDir(), `source-${key}${this.extensionFor(metadata)}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    return target;
  }

  async downloadCandidate(context, sourceUrl, imageUrl) {
    if (!/^https?:\/\//i.test(String(imageUrl || ''))) return null;
    try {
      const response = await context.request.get(String(imageUrl), {
        timeout: 30000,
        headers: {
          Referer: String(sourceUrl || ''),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
        }
      });
      if (!response.ok()) return null;
      const buffer = await response.body();
      const saved = await this.saveBuffer(buffer, sourceUrl, imageUrl);
      return { path: saved, imageUrl };
    } catch {
      return null;
    }
  }

  async inspectPage(page) {
    return page.evaluate(() => {
      const candidates = [];
      const add = (url, score = 0) => {
        const value = String(url || '').trim();
        if (!/^https?:\/\//i.test(value)) return;
        if (/sprite|spacer|pixel|logo|favicon|icon/i.test(value)) score -= 5000;
        if (!candidates.some((item) => item.url === value)) candidates.push({ url: value, score });
      };

      add(document.querySelector('meta[property="og:image"]')?.content, 15000);
      add(document.querySelector('meta[name="twitter:image"]')?.content, 14000);
      add(document.querySelector('meta[name="twitter:image:src"]')?.content, 14000);
      add(document.querySelector('link[rel="image_src"]')?.href, 13000);

      for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(node.textContent || 'null');
          const roots = Array.isArray(parsed) ? parsed : [parsed];
          for (const root of roots) {
            const objects = Array.isArray(root?.['@graph']) ? root['@graph'] : [root];
            for (const object of objects) {
              if (!object || typeof object !== 'object') continue;
              const images = Array.isArray(object.image) ? object.image : [object.image];
              for (const image of images) {
                if (typeof image === 'string') add(image, 13500);
                else if (image && typeof image === 'object') add(image.url || image.contentUrl, 13500);
              }
            }
          }
        } catch {}
      }

      const images = [...document.images];
      images.forEach((img, index) => {
        const rect = img.getBoundingClientRect();
        const width = img.naturalWidth || rect.width || 0;
        const height = img.naturalHeight || rect.height || 0;
        if (width < 120 || height < 120) return;
        let score = Math.min(12000, (width * height) / 100);
        const text = `${img.alt || ''} ${img.id || ''} ${img.className || ''}`;
        if (/landingImage|main-image|product|design|shirt|tee|apparel/i.test(text)) score += 7000;
        if (/logo|avatar|icon|thumb/i.test(text)) score -= 5000;
        add(img.getAttribute('data-old-hires'), score + 5000);
        add(img.getAttribute('data-a-hires'), score + 4500);
        add(img.currentSrc, score + 2500);
        add(img.src, score + 2000);
        const dynamic = img.getAttribute('data-a-dynamic-image');
        if (dynamic) {
          try {
            const parsed = JSON.parse(dynamic);
            for (const [url, size] of Object.entries(parsed)) {
              const area = Array.isArray(size) ? Number(size[0] || 0) * Number(size[1] || 0) : 0;
              add(url, score + 4000 + Math.min(4000, area / 50000));
            }
          } catch {}
        }
      });

      candidates.sort((a, b) => b.score - a.score);
      const body = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        title: String(document.querySelector('#productTitle')?.textContent || document.querySelector('h1')?.textContent || document.querySelector('meta[property="og:title"]')?.content || document.title || '').replace(/\s+/g, ' ').trim(),
        candidates: candidates.slice(0, 16),
        challenge: /robot check|enter the characters you see below|make sure you're not a robot|captcha/i.test(`${document.title}\n${body}`),
        dead: /page not found|couldn['’]t find that page|not a functioning page/i.test(body),
        href: location.href,
        bestImageIndex: images.reduce((best, img, index) => {
          const rect = img.getBoundingClientRect();
          const area = Math.max(0, rect.width) * Math.max(0, rect.height);
          const current = best.index < 0 || area > best.area ? { index, area } : best;
          return current;
        }, { index: -1, area: 0 }).index
      };
    });
  }

  async screenshotFallback(page, sourceUrl, detail) {
    if (!Number.isInteger(detail.bestImageIndex) || detail.bestImageIndex < 0) return null;
    try {
      const locator = page.locator('img').nth(detail.bestImageIndex);
      if (!(await locator.isVisible({ timeout: 1200 }).catch(() => false))) return null;
      const buffer = await locator.screenshot({ timeout: 12000 });
      const saved = await this.saveBuffer(buffer, sourceUrl, `screenshot:${detail.bestImageIndex}`);
      return { path: saved, imageUrl: null };
    } catch {
      return null;
    }
  }

  async resolve(sourceUrl) {
    const url = String(sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Enter a valid Amazon/source URL before fetching a reference image.');

    const cached = this.cachedFor(url);
    if (cached) return { ok: true, cached: true, ...cached };

    const context = await this.ensureContext();
    const amazon = isAmazonUrl(url);
    const canonical = amazon ? canonicalAmazonUrl(url) : null;
    const attempts = amazon ? [url, canonical || url, canonical || url] : [url, url];
    let lastError = null;

    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      const target = attempts[attempt];
      const page = await context.newPage();
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(900 + attempt * 500);
        const detail = await this.inspectPage(page);
        if (detail.challenge) throw new Error('The source site is showing a CAPTCHA / robot check. Complete it manually in a normal browser, then retry.');
        if (detail.dead) throw new Error('The source page appears to be unavailable or not found.');

        for (const candidate of detail.candidates || []) {
          const downloaded = await this.downloadCandidate(context, detail.href || target, candidate.url);
          if (!downloaded) continue;
          const result = {
            ok: true,
            cached: false,
            path: downloaded.path,
            imageUrl: downloaded.imageUrl,
            title: detail.title || null,
            resolvedUrl: detail.href || target,
            attempts: attempt + 1,
            sourceType: amazon ? 'amazon' : 'web'
          };
          this.remember(url, result);
          return result;
        }

        const screenshot = await this.screenshotFallback(page, url, detail);
        if (screenshot) {
          const result = {
            ok: true,
            cached: false,
            path: screenshot.path,
            imageUrl: null,
            title: detail.title || null,
            resolvedUrl: detail.href || target,
            attempts: attempt + 1,
            sourceType: amazon ? 'amazon-screenshot' : 'web-screenshot'
          };
          this.remember(url, result);
          return result;
        }

        throw new Error('The source page loaded, but ZeroPOD could not find a usable reference image.');
      } catch (error) {
        lastError = error;
      } finally {
        await page.close().catch(() => {});
      }
      if (attempt < attempts.length - 1) await wait(700 * (attempt + 1));
    }

    throw new Error(lastError?.message || 'Could not fetch a reference image from the source URL.');
  }

  async close() {
    if (!this.contextPromise) return;
    try {
      const context = await this.contextPromise;
      await context.close().catch(() => {});
    } finally {
      this.contextPromise = null;
    }
  }
}

module.exports = { SourceImageResolver, isAmazonUrl, extractAsin, canonicalAmazonUrl };
