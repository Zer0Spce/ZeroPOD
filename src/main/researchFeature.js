const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ResearchStore } = require('./researchStore');
const { ZeroPODBuiltInProvider, MARKETPLACES, BEST_SELLER_PRESETS, canonicalAmazonUrl, computeTrend } = require('./researchProvider');

function sameUrl(a, b) {
  return String(a || '').trim().replace(/\/$/, '').toLowerCase() === String(b || '').trim().replace(/\/$/, '').toLowerCase();
}

class ResearchFeature {
  constructor({ sessions, automationStore, projects }) {
    this.sessions = sessions;
    this.automationStore = automationStore;
    this.projects = projects;
    this.store = new ResearchStore();
    this.provider = new ZeroPODBuiltInProvider({ sessions, store: this.store });
  }

  enrich(item) {
    const history = Array.isArray(item.history) ? item.history : [];
    const trend7 = computeTrend(history, 'bsr', 7) || computeTrend(history, 'bestSellerPosition', 7);
    const trend30 = computeTrend(history, 'bsr', 30) || computeTrend(history, 'bestSellerPosition', 30);
    const cachedImagePath = item.cachedImagePath && fs.existsSync(item.cachedImagePath) ? item.cachedImagePath : null;
    return { ...item, cachedImagePath, trend7, trend30 };
  }

  list(filters = {}) { return this.store.list(filters).map((item) => this.enrich(item)); }
  get(key) { const item = this.store.get(key); return item ? this.enrich(item) : null; }
  marketplaces() { return MARKETPLACES; }
  presets() { return BEST_SELLER_PRESETS; }

  async refreshBestSellers(payload) {
    const result = await this.provider.refreshBestSellers(payload || {});
    return { ...result, items: result.items.map((item) => this.enrich(item)) };
  }

  async importProduct({ value, marketplace }) { return this.enrich(await this.provider.importProduct(value, marketplace)); }
  save(key, saved) { return this.enrich(this.store.setSaved(key, saved)); }
  async openAmazon(url) { if (url) await shell.openExternal(url); return { ok: true }; }

  duplicateReason(item) {
    const canonicalUrl = item.canonicalUrl || canonicalAmazonUrl(item.marketplace, item.asin);
    const queueRows = this.automationStore.read().rows || [];
    if (queueRows.some((row) => row.research?.marketplace === item.marketplace && row.research?.asin === item.asin)) return 'already in Automation List';
    if (queueRows.some((row) => sameUrl(row.amazonLink, canonicalUrl))) return 'already in Automation List';
    if (this.projects.findBySourceUrl(canonicalUrl).length) return 'already exists as a ZeroPOD project';
    return null;
  }

  ensureResearchImage(item) {
    const file = item.cachedImagePath;
    if (!file || !fs.existsSync(file) || fs.statSync(file).size < 1000) throw new Error(`${item.asin}: cached product image is unavailable. Refresh/import this research item before adding it to Automation.`);
    return file;
  }

  copyIntoProtectedAutomationStorage(item, rowId) {
    const source = this.ensureResearchImage(item);
    const ext = path.extname(source) || '.jpg';
    const dir = path.join(app.getPath('userData'), 'automation-inputs', rowId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `reference${ext.toLowerCase()}`);
    fs.copyFileSync(source, target);
    return target;
  }

  addToAutomation(keys = []) {
    const uniqueKeys = [...new Set((keys || []).filter(Boolean))];
    const queue = this.automationStore.read();
    const capacity = Math.max(0, 15 - queue.rows.length);
    const added = [];
    const skipped = [];
    const now = new Date().toISOString();

    for (const key of uniqueKeys) {
      const item = this.store.get(key);
      if (!item) { skipped.push({ key, reason: 'research item not found' }); continue; }
      const duplicate = this.duplicateReason(item);
      if (duplicate) { skipped.push({ key, reason: duplicate }); continue; }
      if (added.length >= capacity) { skipped.push({ key, reason: 'Automation List is full (15 row maximum)' }); continue; }

      const rowId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      let referenceImage;
      try { referenceImage = this.copyIntoProtectedAutomationStorage(item, rowId); }
      catch (error) { skipped.push({ key, reason: error.message || String(error) }); continue; }
      const amazonLink = item.canonicalUrl || canonicalAmazonUrl(item.marketplace, item.asin);
      added.push({
        id: rowId,
        enabled: true,
        referenceImage,
        amazonLink,
        notes: '',
        status: 'pending',
        step: 'Waiting',
        checkpoint: 'input-ready',
        projectId: null,
        createdAt: now,
        research: {
          source: 'research',
          researchKey: item.key,
          marketplace: item.marketplace,
          asin: item.asin,
          title: item.title || null,
          productType: item.productType || null,
          verifiedBestSeller: Boolean(item.verifiedBestSeller),
          bestSellerPosition: item.bestSellerPosition ?? null,
          bestSellerCategory: item.bestSellerCategory || null,
          bsr: item.bsr ?? null,
          bsrCategory: item.bsrCategory || null,
          price: item.price || null,
          rating: item.rating ?? null,
          reviewCount: item.reviewCount ?? null,
          dateFirstAvailable: item.dateFirstAvailable || null,
          firstSeenAt: item.firstSeenAt || null,
          lastVerifiedAt: item.lastVerifiedAt || null,
          winnerScore: item.winnerScore || null
        }
      });
    }

    if (added.length) this.automationStore.addRows(added);
    return { selected: uniqueKeys.length, added: added.length, skipped: skipped.length, skippedItems: skipped, rows: added.map((row) => ({ id: row.id, researchKey: row.research.researchKey })) };
  }
}

module.exports = { ResearchFeature };