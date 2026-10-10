const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class ResearchStore {
  getRoot() { return path.join(app.getPath('userData'), 'research'); }
  getFile() { return path.join(this.getRoot(), 'research.json'); }
  getBackupFile() { return `${this.getFile()}.bak`; }
  getCacheDir() { return path.join(this.getRoot(), 'cache'); }
  getThumbnailDir() { return path.join(this.getRoot(), 'thumbnails'); }

  empty() {
    return {
      version: 1,
      products: {},
      updatedAt: null,
      contexts: {},
      settings: { provider: 'zeropod-built-in' }
    };
  }

  normalize(data = {}) {
    return {
      version: 1,
      products: data.products && typeof data.products === 'object' ? data.products : {},
      updatedAt: data.updatedAt || null,
      contexts: data.contexts && typeof data.contexts === 'object' ? data.contexts : {},
      settings: { provider: 'zeropod-built-in', ...(data.settings || {}) }
    };
  }

  readFile(file) { return this.normalize(JSON.parse(fs.readFileSync(file, 'utf8'))); }

  read() {
    const file = this.getFile();
    const backup = this.getBackupFile();
    if (!fs.existsSync(file)) return this.empty();
    try { return this.readFile(file); }
    catch {
      try { if (fs.existsSync(backup)) return this.readFile(backup); }
      catch {}
      return this.empty();
    }
  }

  write(data) {
    const root = this.getRoot();
    const file = this.getFile();
    const backup = this.getBackupFile();
    const temp = `${file}.tmp`;
    fs.mkdirSync(root, { recursive: true });
    try { if (fs.existsSync(file)) fs.copyFileSync(file, backup); } catch {}
    const next = { ...data, updatedAt: new Date().toISOString() };
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
    fs.copyFileSync(temp, file);
    fs.rmSync(temp, { force: true });
    return next;
  }

  key(marketplace, asin) { return `${String(marketplace || '').toUpperCase()}:${String(asin || '').toUpperCase()}`; }

  snapshotFor(product, at = new Date().toISOString()) {
    return {
      at,
      verifiedBestSeller: Boolean(product.verifiedBestSeller),
      bestSellerPosition: product.bestSellerPosition ?? null,
      bestSellerCategory: product.bestSellerCategory || null,
      bsr: product.bsr ?? null,
      bsrCategory: product.bsrCategory || null,
      price: product.price || null,
      rating: product.rating ?? null,
      reviewCount: product.reviewCount ?? null,
      availability: product.availability || null
    };
  }

  isMeaningfullyDifferent(a, b) {
    if (!a) return true;
    const fields = ['verifiedBestSeller','bestSellerPosition','bestSellerCategory','bsr','bsrCategory','price','rating','reviewCount','availability'];
    return fields.some((field) => (a[field] ?? null) !== (b[field] ?? null));
  }

  upsert(input, context = {}) {
    if (!input?.asin || !input?.marketplace) throw new Error('Research product requires marketplace + ASIN.');
    const data = this.read();
    const key = this.key(input.marketplace, input.asin);
    const now = new Date().toISOString();
    const previous = data.products[key] || null;
    const firstSeenAt = previous?.firstSeenAt || input.firstSeenAt || now;
    const history = Array.isArray(previous?.history) ? [...previous.history] : [];
    const merged = {
      ...(previous || {}),
      ...clone(input),
      id: key,
      key,
      marketplace: String(input.marketplace).toUpperCase(),
      asin: String(input.asin).toUpperCase(),
      firstSeenAt,
      lastCheckedAt: input.lastCheckedAt || now,
      lastVerifiedAt: input.verifiedBestSeller ? (input.lastVerifiedAt || now) : (previous?.lastVerifiedAt || input.lastVerifiedAt || null),
      saved: input.saved !== undefined ? Boolean(input.saved) : Boolean(previous?.saved),
      history
    };
    const nextSnapshot = this.snapshotFor(merged, now);
    const lastSnapshot = history.length ? history[history.length - 1] : null;
    if (this.isMeaningfullyDifferent(lastSnapshot, nextSnapshot)) merged.history = [...history, nextSnapshot].slice(-500);
    data.products[key] = merged;
    if (context.contextKey) {
      data.contexts[context.contextKey] = {
        ...(data.contexts[context.contextKey] || {}),
        ...context,
        updatedAt: now
      };
    }
    this.write(data);
    return clone(merged);
  }

  get(key) {
    const item = this.read().products[key];
    return item ? clone(item) : null;
  }

  list(filters = {}) {
    const data = this.read();
    let items = Object.values(data.products).map(clone);
    if (filters.marketplace) items = items.filter((item) => item.marketplace === String(filters.marketplace).toUpperCase());
    if (filters.savedOnly) items = items.filter((item) => item.saved);
    if (filters.verifiedOnly) items = items.filter((item) => item.verifiedBestSeller);
    if (filters.productType && filters.productType !== 'all') items = items.filter((item) => item.productType === filters.productType);
    if (filters.search) {
      const q = String(filters.search).trim().toLowerCase();
      items = items.filter((item) => [item.title,item.asin,item.category,item.bestSellerCategory,item.bsrCategory].some((value) => String(value || '').toLowerCase().includes(q)));
    }
    return items.sort((a, b) => {
      if (a.verifiedBestSeller !== b.verifiedBestSeller) return a.verifiedBestSeller ? -1 : 1;
      const ar = Number.isFinite(a.bestSellerPosition) ? a.bestSellerPosition : Number.MAX_SAFE_INTEGER;
      const br = Number.isFinite(b.bestSellerPosition) ? b.bestSellerPosition : Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0);
    });
  }

  setSaved(key, saved) {
    const data = this.read();
    if (!data.products[key]) throw new Error(`Research item not found: ${key}`);
    data.products[key].saved = Boolean(saved);
    data.products[key].updatedAt = new Date().toISOString();
    this.write(data);
    return clone(data.products[key]);
  }

  getContext(contextKey) { return clone(this.read().contexts[contextKey] || null); }
}

module.exports = { ResearchStore };
