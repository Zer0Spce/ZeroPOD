const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ResearchStore } = require('./researchStore');
const { ZeroPODBuiltInProvider, MARKETPLACES, BEST_SELLER_PRESETS, canonicalAmazonUrl, computeTrend } = require('./researchProvider');
const { assessTrademarkRisk } = require('./researchTrademarkSafety');

const POD_TYPES = new Set(['tshirt', 'hoodie', 'sweatshirt', 'tank']);
const POD_TITLE_PATTERNS = {
  tshirt: /\b(?:t-?shirts?|tees?|graphic shirts?|novelty shirts?)\b/i,
  hoodie: /\b(?:hoodies?|hooded sweatshirts?)\b/i,
  sweatshirt: /\b(?:sweatshirts?|crewnecks?)\b/i,
  tank: /\b(?:tank tops?|tanktops?|racerbacks?)\b/i
};

function sameUrl(a, b) {
  return String(a || '').trim().replace(/\/$/, '').toLowerCase() === String(b || '').trim().replace(/\/$/, '').toLowerCase();
}

function trademarkAssessment(item) {
  if (item?.trademarkRisk === true) {
    return {
      risky: true,
      reason: item.trademarkRiskReason || 'stored-trademark-risk',
      matched: item.trademarkRiskMatched || null
    };
  }
  return assessTrademarkRisk(item || {});
}

function isPodDesign(item, requestedType = 'all') {
  if (!item) return false;
  const type = String(item.productType || '').trim().toLowerCase();
  if (!POD_TYPES.has(type)) return false;
  if (requestedType && requestedType !== 'all' && type !== requestedType) return false;

  // Never surface or queue obvious licensed / branded / trademark-risk designs.
  if (trademarkAssessment(item).risky) return false;

  // Strict Research rule: a supported apparel title is not enough. The Amazon
  // product must have positive POD / Merch provenance.
  if (item.merchOnDemandVerified !== true) return false;

  const title = String(item.title || '').trim();
  if (!title) return false;
  const pattern = POD_TITLE_PATTERNS[type];
  return Boolean(pattern && pattern.test(title));
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

  list(filters = {}) {
    const requestedType = filters.productType || 'all';
    return this.store.list(filters)
      .filter((item) => isPodDesign(item, requestedType))
      .map((item) => this.enrich(item));
  }

  get(key) {
    const item = this.store.get(key);
    return item && isPodDesign(item) ? this.enrich(item) : null;
  }

  marketplaces() { return MARKETPLACES; }
  presets() { return BEST_SELLER_PRESETS; }

  async refreshBestSellers(payload = {}) {
    const result = await this.provider.refreshBestSellers(payload || {});
    const requestedType = payload.productType || 'all';
    const podItems = result.items.filter((item) => isPodDesign(item, requestedType));
    return {
      ...result,
      rawCount: result.sourceCount ?? result.rawCount ?? result.items.length,
      filteredOut: (result.sourceCount ?? result.items.length) - podItems.length,
      count: podItems.length,
      items: podItems.map((item) => this.enrich(item))
    };
  }

  async importProduct({ value, marketplace }) {
    const item = await this.provider.importProduct(value, marketplace);
    const risk = trademarkAssessment(item);
    if (risk.risky) {
      throw new Error(`Skipped potential trademark/licensed design${risk.matched ? ` (${risk.matched})` : ''}. ZeroPOD Research does not allow obvious brand or franchise designs into Automation.`);
    }
    if (!isPodDesign(item)) {
      throw new Error('That Amazon item is not a verified Amazon POD / Merch design. ZeroPOD Research only accepts verified POD design listings.');
    }
    return this.enrich(item);
  }

  save(key, saved) {
    const item = this.store.get(key);
    if (!item || !isPodDesign(item)) throw new Error('Research item is not an eligible trademark-safe POD design.');
    return this.enrich(this.store.setSaved(key, saved));
  }

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
      const risk = trademarkAssessment(item);
      if (risk.risky) { skipped.push({ key, reason: `potential trademark/licensed design${risk.matched ? `: ${risk.matched}` : ''}` }); continue; }
      if (!isPodDesign(item)) { skipped.push({ key, reason: 'not an eligible verified Amazon POD / Merch design' }); continue; }
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
          merchOnDemandVerified: true,
          merchOnDemandEvidence: item.merchOnDemandEvidence || null,
          merchOnDemandCheckedAt: item.merchOnDemandCheckedAt || null,
          trademarkRisk: false,
          trademarkCheckedAt: item.trademarkCheckedAt || null,
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

module.exports = { ResearchFeature, isPodDesign };
