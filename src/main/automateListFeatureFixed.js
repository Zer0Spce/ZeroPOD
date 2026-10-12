const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { AutomationQueueStore } = require('./automationQueueStore');
const { ResearchStore } = require('./researchStore');
const { ZeroPODBuiltInProvider, extractAsin, marketplaceFromUrl } = require('./researchProvider');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_AUTOMATE_ITEMS = 30;
const MAX_AUTOMATION_ROWS = 30;

function cleanExtractedUrl(value) {
  return String(value || '')
    .trim()
    .replace(/[\\\])}>.,;:!?]+$/g, '');
}

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  return matches.map(cleanExtractedUrl).filter(Boolean);
}

function isAmazonHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return /^(?:amazon\.(?:com|de|fr|it|es)|amazon\.co\.uk)$/.test(host);
  } catch {
    return false;
  }
}

async function extractUrlsFromXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const urls = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.hyperlink) urls.push(...extractUrls(cell.hyperlink));
        if (cell.text) urls.push(...extractUrls(cell.text));
        else if (typeof cell.value === 'string') urls.push(...extractUrls(cell.value));
      });
    });
  }
  return urls;
}

async function extractUrlsFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx') return extractUrlsFromXlsx(filePath);
  if (ext === '.xls') throw new Error('Legacy .xls files are not supported yet. Save the file as .xlsx, CSV, or text and try again.');
  return extractUrls(fs.readFileSync(filePath, 'utf8'));
}

class AutomateListStore {
  getFile() { return path.join(app.getPath('userData'), 'automate-list.json'); }
  empty() { return { state: 'stopped', sourceFile: null, items: [], updatedAt: null, lastMessage: null }; }
  read() {
    try {
      const file = this.getFile();
      if (!fs.existsSync(file)) return this.empty();
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...this.empty(), ...parsed, items: Array.isArray(parsed.items) ? parsed.items : [] };
    } catch {
      return this.empty();
    }
  }
  write(data) {
    const next = { ...data, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.getFile()), { recursive: true });
    fs.writeFileSync(this.getFile(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
  updateItem(itemId, patch) {
    const data = this.read();
    const index = data.items.findIndex((item) => item.id === itemId);
    if (index < 0) return data;
    data.items[index] = { ...data.items[index], ...patch, updatedAt: new Date().toISOString() };
    return this.write(data);
  }
}

class AutomateListFeature {
  constructor({ sessions }) {
    this.sessions = sessions;
    this.store = new AutomateListStore();
    this.automationStore = new AutomationQueueStore();
    this.researchStore = new ResearchStore();
    this.provider = new ZeroPODBuiltInProvider({ sessions, store: this.researchStore });
    this.loopPromise = null;
    this.stopRequested = false;
  }

  snapshot() {
    const data = this.store.read();
    const counts = data.items.reduce((acc, item) => {
      acc.total += 1;
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, { total: 0 });
    const automationRows = this.automationStore.read().rows || [];
    return {
      ...data,
      maxItems: MAX_AUTOMATE_ITEMS,
      counts,
      automation: {
        used: automationRows.length,
        limit: MAX_AUTOMATION_ROWS,
        available: Math.max(0, MAX_AUTOMATION_ROWS - automationRows.length)
      }
    };
  }

  async importFile(filePath) {
    const rawUrls = await extractUrlsFromFile(filePath);
    const seen = new Set();
    const unique = [];
    for (const raw of rawUrls) {
      const url = cleanExtractedUrl(raw);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      unique.push(url);
    }
    if (!unique.length) throw new Error('No web links were found in that file.');

    const accepted = unique.slice(0, MAX_AUTOMATE_ITEMS);
    const ignored = Math.max(0, unique.length - accepted.length);
    const now = new Date().toISOString();
    const items = accepted.map((url) => ({
      id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      url,
      status: 'pending',
      reason: null,
      asin: extractAsin(url),
      marketplace: marketplaceFromUrl(url),
      title: null,
      referenceImage: null,
      automationRowId: null,
      createdAt: now,
      updatedAt: now
    }));

    this.stopRequested = true;
    this.store.write({
      state: 'stopped',
      sourceFile: filePath,
      items,
      lastMessage: ignored
        ? `Loaded the first ${MAX_AUTOMATE_ITEMS} unique links from ${path.basename(filePath)}. ${ignored} extra link${ignored === 1 ? '' : 's'} were ignored because Automate List has a ${MAX_AUTOMATE_ITEMS}-item maximum.`
        : `Loaded ${items.length} unique link${items.length === 1 ? '' : 's'} from ${path.basename(filePath)}.`
    });
    return this.snapshot();
  }

  clear() {
    const data = this.store.read();
    if (['running', 'waiting-space'].includes(data.state)) throw new Error('Pause or stop Automate List before clearing it.');
    this.stopRequested = true;
    this.store.write(this.store.empty());
    return this.snapshot();
  }

  start() {
    const data = this.store.read();
    if (!data.items.length) throw new Error('Upload a list file first.');
    this.stopRequested = false;
    this.store.write({ ...data, state: 'running', lastMessage: 'Processing Amazon links one at a time.' });
    if (!this.loopPromise) this.loopPromise = this.runLoop().finally(() => { this.loopPromise = null; });
    return this.snapshot();
  }

  pause() {
    const data = this.store.read();
    this.store.write({ ...data, state: 'paused', lastMessage: 'Paused.' });
    return this.snapshot();
  }

  stop() {
    this.stopRequested = true;
    const data = this.store.read();
    this.store.write({ ...data, state: 'stopped', lastMessage: 'Stopped.' });
    return this.snapshot();
  }

  existingAutomationDuplicate(url, asin) {
    const rows = this.automationStore.read().rows || [];
    return rows.find((row) => {
      if (String(row.amazonLink || '').trim() === String(url || '').trim()) return true;
      return Boolean(asin && extractAsin(row.amazonLink) === asin);
    }) || null;
  }

  automationHasSpace() {
    return (this.automationStore.read().rows || []).length < MAX_AUTOMATION_ROWS;
  }

  copyIntoAutomationStorage(sourceFile, rowId) {
    const ext = (path.extname(sourceFile) || '.jpg').toLowerCase();
    const dir = path.join(app.getPath('userData'), 'automation-inputs', rowId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `reference${ext}`);
    fs.copyFileSync(sourceFile, target);
    return target;
  }

  async fetchAmazonProduct(item) {
    const asin = extractAsin(item.url);
    const marketplace = marketplaceFromUrl(item.url);
    if (!isAmazonHost(item.url) || !asin || !marketplace) {
      const error = new Error('Invalid or unsupported Amazon product link.');
      error.code = 'INVALID_LINK';
      throw error;
    }

    const { page } = await this.provider.ensurePage(marketplace, item.url);
    const detail = await page.evaluate(() => {
      const body = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const title = document.querySelector('#productTitle')?.textContent?.replace(/\s+/g, ' ').trim() || null;
      const image = document.querySelector('#landingImage, #imgBlkFront, #main-image, #imageBlock_feature_div img');
      let imageUrl = image?.getAttribute('data-old-hires') || image?.currentSrc || image?.src || null;
      const dynamic = image?.getAttribute('data-a-dynamic-image');
      if (dynamic) {
        try {
          const parsed = JSON.parse(dynamic);
          const candidates = Object.entries(parsed)
            .map(([url, size]) => ({ url, area: Array.isArray(size) ? Number(size[0] || 0) * Number(size[1] || 0) : 0 }))
            .sort((a, b) => b.area - a.area);
          if (candidates[0]?.url) imageUrl = candidates[0].url;
        } catch {}
      }
      const dead = /sorry[, ]+we couldn['’]t find that page|page not found|the web address you entered is not a functioning page|looking for something\?/i.test(body);
      return { title, imageUrl, dead };
    });

    if (detail.dead || !detail.title || !detail.imageUrl) {
      const error = new Error('Amazon listing is unavailable, dead, or does not expose a product image.');
      error.code = 'DEAD_LINK';
      throw error;
    }

    const cachedImagePath = await this.provider.downloadImage(detail.imageUrl, marketplace, asin);
    if (!cachedImagePath || !fs.existsSync(cachedImagePath) || fs.statSync(cachedImagePath).size < 1000) {
      const error = new Error('Amazon product image could not be downloaded.');
      error.code = 'DEAD_LINK';
      throw error;
    }
    return { asin, marketplace, title: detail.title, cachedImagePath };
  }

  async processItem(item) {
    const asin = extractAsin(item.url);
    if (!isAmazonHost(item.url) || !asin || !marketplaceFromUrl(item.url)) {
      this.store.updateItem(item.id, { status: 'skipped', reason: 'Invalid or unsupported Amazon product link.' });
      return;
    }

    const duplicate = this.existingAutomationDuplicate(item.url, asin);
    if (duplicate) {
      this.store.updateItem(item.id, { status: 'skipped', reason: 'Already exists in Automation.', automationRowId: duplicate.id || null });
      return;
    }

    this.store.updateItem(item.id, { status: 'checking', reason: null });
    let product;
    try {
      product = await this.fetchAmazonProduct(item);
    } catch (error) {
      const message = error.message || String(error);
      if (/captcha|robot check|human|sign-in|sign in|requires sign/i.test(message)) {
        this.store.updateItem(item.id, { status: 'needs-attention', reason: message });
        const data = this.store.read();
        this.store.write({ ...data, state: 'paused', lastMessage: 'Amazon needs attention. Complete the normal Amazon Research browser check/login, then press Resume.' });
        return;
      }
      this.store.updateItem(item.id, { status: 'skipped', reason: message });
      return;
    }

    if (!this.automationHasSpace()) {
      this.store.updateItem(item.id, {
        status: 'waiting-space',
        reason: `Automation is full (${MAX_AUTOMATION_ROWS}/${MAX_AUTOMATION_ROWS}). Waiting for a row to be cleared.`,
        asin: product.asin,
        marketplace: product.marketplace,
        title: product.title,
        referenceImage: product.cachedImagePath
      });
      return;
    }

    const rowId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const referenceImage = this.copyIntoAutomationStorage(product.cachedImagePath, rowId);
    this.automationStore.addRows([{
      id: rowId,
      enabled: true,
      referenceImage,
      amazonLink: item.url,
      notes: '',
      status: 'pending',
      step: 'Waiting',
      checkpoint: 'input-ready',
      projectId: null
    }]);

    this.store.updateItem(item.id, {
      status: 'added',
      reason: 'Image + Amazon link sent to Automation.',
      asin: product.asin,
      marketplace: product.marketplace,
      title: product.title,
      referenceImage,
      automationRowId: rowId
    });
  }

  async runLoop() {
    while (!this.stopRequested) {
      let data = this.store.read();
      if (data.state === 'stopped') break;
      if (data.state === 'paused') { await wait(1200); continue; }

      const waiting = data.items.find((item) => item.status === 'waiting-space');
      if (waiting) {
        if (!this.automationHasSpace()) {
          if (data.state !== 'waiting-space') this.store.write({ ...data, state: 'waiting-space', lastMessage: 'Automation is full. Automate List will continue automatically when space becomes available.' });
          await wait(2000);
          continue;
        }
        this.store.updateItem(waiting.id, { status: 'pending', reason: null });
        data = this.store.read();
        this.store.write({ ...data, state: 'running', lastMessage: 'Automation space is available. Resuming import.' });
      }

      const next = this.store.read().items.find((item) => item.status === 'pending');
      if (!next) {
        const current = this.store.read();
        const hasAttention = current.items.some((item) => item.status === 'needs-attention');
        this.store.write({
          ...current,
          state: hasAttention ? 'paused' : 'completed',
          lastMessage: hasAttention ? 'Paused because Amazon needs attention.' : 'Finished processing all imported links.'
        });
        break;
      }

      await this.processItem(next);
      await wait(400);
    }
  }
}

module.exports = { AutomateListFeature, extractUrls, extractUrlsFromFile, MAX_AUTOMATE_ITEMS, MAX_AUTOMATION_ROWS };
