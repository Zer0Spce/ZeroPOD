const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { ResearchStore } = require('./researchStore');
const { MARKETPLACES, canonicalAmazonUrl } = require('./researchProvider');
const { assessTrademarkRisk } = require('./researchTrademarkSafety');
const { readFlyingListCards, isFlyingResultsReady } = require('./flyingResearchDom');

const ORIGIN = 'https://app.flyingresearch.net/';
const TOOLS = {
  best: { label: 'Best Sellers', route: 'best-sellers' },
  trends: { label: 'Seller Trends', route: 'seller-trends' },
  archive: { label: 'Archive', route: 'archive' },
  deleted: { label: 'Deleted Designs', route: 'deleted-designs' },
  live: { label: 'Real Time Research', route: 'real-time-research' },
  niche: { label: 'Niche Analysis', route: 'niche-analysis' },
  inspired: { label: 'Get Inspired POD', route: 'get-inspired-pod' },
  brands: { label: 'Official Brands', route: 'brands' },
  favorites: { label: 'Flying Favorites', route: 'favorites' },
  report: { label: 'POD Report', route: 'pod-report' }
};
const PRODUCTS = { tshirt: 'T-Shirt', hoodie: 'Hoodie', popsockets: 'PopSockets', phone: 'Phone Case', tote: 'Tote Bag', tumbler: 'Tumbler', mug: 'Ceramic Mug', kdp: 'KDP' };

class FlyingResearchStore extends ResearchStore {
  getRoot() { return path.join(app.getPath('userData'), 'flying-research'); }
}

function normalizeFlyingCard(raw, sourceUrl, at = new Date().toISOString()) {
  const asin = String(raw.asin || '').toUpperCase();
  const marketplace = String(raw.marketplace || '').toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin) || !MARKETPLACES[marketplace] || !raw.title) return null;
  let imageUrl = null;
  try {
    const url = new URL(raw.imageUrl);
    if (url.protocol === 'https:' && ['m.media-amazon.com', 'images-na.ssl-images-amazon.com'].includes(url.hostname)) imageUrl = url.href;
  } catch {}
  const n = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const trend = String(raw.trendDescription || '');
  const pct = trend.match(/(?:improved|worsened) by ([\d.]+)%/i);
  const improvementPercent = pct ? Number(pct[1]) * (/worsened/i.test(trend) ? -1 : 1) : null;
  const type = Object.entries(PRODUCTS).find(([, label]) => label === raw.productLabel)?.[0] || 'unknown';
  const risk = assessTrademarkRisk({ title: raw.title, brand: raw.brand, description: (raw.bulletpoints || []).join(' ') });
  return {
    asin, marketplace, title: String(raw.title).slice(0, 2000), brand: raw.brand || null,
    imageUrl, canonicalUrl: canonicalAmazonUrl(marketplace, asin), productType: type,
    bsr: n(raw.bsr), estimatedSales30: n(raw.estimatedSales30), priceValue: n(raw.priceValue),
    currency: raw.currency || MARKETPLACES[marketplace].currency,
    price: n(raw.priceValue) === null ? null : `${raw.currency || MARKETPLACES[marketplace].currency} ${Number(raw.priceValue).toFixed(2)}`,
    rating: n(raw.rating), reviewCount: n(raw.reviewCount), dateFirstAvailable: raw.dateFirstAvailable || null,
    trendDescription: raw.trendDescription || null, improvementPercent,
    bulletpoints: (raw.bulletpoints || []).slice(0, 10), source: 'flying-research', sourceUrl,
    capturedAt: at, lastCheckedAt: at, verifiedBestSeller: false, bestSellerPosition: null,
    trademarkRisk: risk.risky, trademarkRiskMatched: risk.matched || null
  };
}

class FlyingResearchFeature {
  constructor({ sessions, automationStore, projects, store = new FlyingResearchStore() }) {
    Object.assign(this, { sessions, automationStore, projects, store });
    this.page = null;
  }
  list(filters = {}) { return this.store.list(filters); }
  options() { return { tools: TOOLS, products: PRODUCTS, marketplaces: MARKETPLACES }; }
  async ensurePage() {
    if (this.page && !this.page.isClosed()) return this.page;
    const { page } = await this.sessions.ensureService('flyingResearch');
    this.page = page;
    return page;
  }
  async requireSignedIn(page) {
    if (new URL(page.url()).origin !== new URL(ORIGIN).origin) throw new Error('Return to Flying Research in the dedicated browser.');
    const state = await this.sessions.detectAuthState('flyingResearch', page);
    if (state.status !== 'verified') throw new Error('Sign in with Open Login Browser, finish login, then click Test Session.');
  }
  async login() {
    this.page = null;
    return this.sessions.login('flyingResearch');
  }
  async test() {
    const page = await this.ensurePage();
    const result = await this.sessions.detectAuthState('flyingResearch', page);
    this.sessions.updateState('flyingResearch', { authStatus: result.status, lastVerifiedAt: new Date().toISOString(), verificationMessage: result.message });
    return result;
  }
  async showBrowser(page) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 80, width: 1280, height: 900 } });
      await page.bringToFront();
    } finally { await cdp.detach(); }
  }
  async open(tool = 'best') {
    if (!TOOLS[tool]) throw new Error('Unknown Flying Research tool.');
    const page = await this.ensurePage();
    await this.requireSignedIn(page);
    const url = `${ORIGIN}#/research/research/${TOOLS[tool].route}`;
    if (page.url() !== url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.showBrowser(page);
    return { tool, url };
  }
  async waitForResults(page) {
    try {
      await page.waitForFunction(isFlyingResultsReady, null, { timeout: 60000 });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      await this.requireSignedIn(page);
      throw new Error('Flying has not displayed a results list yet. Open Flying Tools to check the search, then Import Current Results once designs appear.');
    }
  }
  async choose(page, name, label) {
    const control = page.getByRole('button', { name, exact: true });
    if ((await control.innerText()).includes(label)) return;
    await control.click();
    const option = page.getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).filter({ hasNot: page.locator(`#${name.toLowerCase()}`) });
    // Dropdown options contain an icon/image label plus the visible choice.
    const candidates = await option.all();
    const visible = [];
    for (const candidate of candidates) if (await candidate.isVisible()) visible.push(candidate);
    if (visible.length !== 1) throw new Error(`Flying ${name} choice changed. Use Open Flying Tools to select ${label}, then Import Current Results.`);
    await visible[0].click();
  }
  async search({ tool = 'best', query = '', marketplace = 'ALL', productType = 'tshirt' } = {}) {
    if (!['best', 'trends', 'archive', 'live', 'favorites'].includes(tool)) throw new Error('Open this analysis tool in Flying, then import a results list when available.');
    if (!PRODUCTS[productType]) throw new Error('Choose a supported product.');
    if (marketplace !== 'ALL' && !MARKETPLACES[marketplace]) throw new Error('Choose a supported marketplace.');
    if (tool === 'live' && !String(query).trim()) throw new Error('Enter a keyword for Real Time Research.');
    const page = await this.ensurePage();
    await this.requireSignedIn(page);
    const url = `${ORIGIN}#/research/research/${TOOLS[tool].route}`;
    if (page.url() !== url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('h1.header-title').filter({ hasText: TOOLS[tool].label }).waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: 'Marketplace', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await this.choose(page, 'Marketplace', marketplace === 'ALL' && tool !== 'live' ? 'All Marketplaces' : MARKETPLACES[marketplace === 'ALL' ? 'US' : marketplace].label);
    await this.choose(page, 'Product', PRODUCTS[productType]);
    const input = page.getByRole('textbox', { name: tool === 'live' ? 'Search Live' : 'Search', exact: true });
    await input.fill(String(query).slice(0, 500));
    const search = page.getByRole('button', { name: /Search$/ }).filter({ hasNotText: /options|analysis/i }).first();
    await search.click({ timeout: 30000 });
    await this.waitForResults(page);
    return this.capture();
  }
  async capture() {
    const page = await this.ensurePage();
    await this.requireSignedIn(page);
    const sourceUrl = page.url();
    if (!sourceUrl.includes('#/research/')) throw new Error('Open a Flying Research results page first.');
    await this.waitForResults(page);
    const at = new Date().toISOString();
    if (await page.locator('.list-card-content,.design-card-v2').count() === 0) return { items: [], count: 0, skippedItems: [], capturedAt: at, sourceUrl };
    const label = page.locator('label[for$="list_view"]');
    if (await label.count() !== 1) throw new Error('This page has no importable results list. Open Best Sellers, Seller Trends, Archive, Favorites, or Real Time Research results.');
    const radioId = await label.getAttribute('for');
    if (!await page.locator(`[id="${radioId}"]`).isChecked()) await label.click({ timeout: 30000 });
    await this.waitForResults(page);
    const raw = await page.evaluate(readFlyingListCards);
    if (!raw.length) throw new Error('No loaded list cards to import. Run a search or load results in Flying first.');
    const items = [], skippedItems = [], seen = new Set();
    for (const card of raw.slice(0, 200)) {
      const item = normalizeFlyingCard(card, sourceUrl, at);
      if (!item) { skippedItems.push({ asin: card.asin, reason: 'Missing title, ASIN, or marketplace' }); continue; }
      const key = this.store.key(item.marketplace, item.asin);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(this.store.upsert(item));
    }
    return { items, count: items.length, skippedItems, capturedAt: at, sourceUrl };
  }
  save({ key, saved }) { return this.store.setSaved(key, saved); }
  eligible(key) {
    const item = this.store.get(key);
    if (!item || item.source !== 'flying-research') throw new Error('Flying design was not found.');
    const risk = assessTrademarkRisk({ title: item.title, brand: item.brand, description: (item.bulletpoints || []).join(' ') });
    if (item.trademarkRisk || risk.risky) throw new Error(`Potential brand/licensed design: ${item.trademarkRiskMatched || risk.matched || item.asin}`);
    return item;
  }
  async cacheImage(item) {
    if (item.cachedImagePath && fs.existsSync(item.cachedImagePath)) return item.cachedImagePath;
    if (!item.imageUrl) throw new Error('Product image unavailable; import this design again.');
    const page = await this.ensurePage();
    const response = await page.context().request.get(item.imageUrl, { timeout: 30000, maxRedirects: 0 });
    try {
      if (!response.ok() || !/^image\/(?:png|jpeg|webp)/i.test(response.headers()['content-type'] || '')) throw new Error('Product image download failed.');
      if (Number(response.headers()['content-length']) > 20000000) throw new Error('Product image is too large.');
      const bytes = await response.body();
      if (bytes.length > 20000000) throw new Error('Product image is too large.');
      const meta = await sharp(bytes, { limitInputPixels: 64000000 }).metadata();
      const ext = { png: '.png', jpeg: '.jpg', webp: '.webp' }[meta.format];
      if (!ext || !meta.width || !meta.height) throw new Error('Product image format is unsupported.');
      const dir = this.store.getCacheDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${item.marketplace}-${item.asin}${ext}`);
      fs.writeFileSync(file, bytes);
      this.store.upsert({ ...item, cachedImagePath: file });
      return file;
    } finally { await response.dispose(); }
  }
  async workflow(key) {
    const item = this.eligible(key);
    const source = await this.cacheImage(item);
    const dir = path.join(app.getPath('userData'), 'flying-workflow-inputs', crypto.randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const referencePath = path.join(dir, `reference${path.extname(source)}`);
    fs.copyFileSync(source, referencePath);
    return { referencePath, sourceUrl: item.canonicalUrl, title: item.title, researchKey: item.key };
  }
  async addToAutomation({ keys = [], newChat = false } = {}) {
    const selected = [...new Set(keys)].slice(0, 200), rows = [], skippedItems = [];
    for (const key of selected) {
      try {
        const item = this.eligible(key);
        const queue = this.automationStore.read();
        if (queue.rows.some((row) => row.amazonLink === item.canonicalUrl) || rows.some((row) => row.amazonLink === item.canonicalUrl) || this.projects.findBySourceUrl(item.canonicalUrl).length) throw new Error('Already in Automation List or Projects.');
        if (queue.rows.length + rows.length >= 15) throw new Error('Automation List is full (15 rows).');
        const source = await this.cacheImage(item);
        const id = crypto.randomUUID();
        const dir = path.join(app.getPath('userData'), 'automation-inputs', id);
        fs.mkdirSync(dir, { recursive: true });
        const referenceImage = path.join(dir, `reference${path.extname(source)}`);
        fs.copyFileSync(source, referenceImage);
        rows.push({ id, enabled: true, referenceImage, amazonLink: item.canonicalUrl, newChat: Boolean(newChat), notes: '', status: 'pending', step: 'Waiting', checkpoint: 'input-ready', projectId: null,
          research: { source: 'flying-research', researchKey: key, asin: item.asin, marketplace: item.marketplace, title: item.title, sourceUrl: item.sourceUrl, capturedAt: item.capturedAt, bsr: item.bsr, estimatedSales30: item.estimatedSales30, verifiedBestSeller: false } });
      } catch (error) { skippedItems.push({ key, reason: error.message || String(error) }); }
    }
    // Re-check after network waits so other UI additions cannot exceed capacity.
    const current = this.automationStore.read();
    const accepted = [];
    for (const row of rows) {
      if (current.rows.length + accepted.length >= 15 || current.rows.some((existing) => existing.amazonLink === row.amazonLink)) {
        fs.rmSync(path.dirname(row.referenceImage), { recursive: true, force: true });
        skippedItems.push({ key: row.research.researchKey, reason: 'Queue changed while importing; full or duplicate.' });
      } else accepted.push(row);
    }
    if (accepted.length) {
      this.automationStore.addRows(accepted);
      for (const row of accepted) this.automationStore.updateRow(row.id, { newChat: row.newChat });
    }
    return { added: accepted.length, rows: accepted.map((row) => ({ id: row.id, researchKey: row.research.researchKey })), skippedItems };
  }
}
module.exports = { FlyingResearchFeature, FlyingResearchStore, normalizeFlyingCard, TOOLS, ORIGIN };
