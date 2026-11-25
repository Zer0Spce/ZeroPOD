const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FlyingResearchFeature } = require('./flyingResearchFeature');
const { AutomationQueueStore } = require('./automationQueueStore');

const MAX_AUTOMATION_ROWS = 50;
const previousAddRows = AutomationQueueStore.prototype.addRows;

AutomationQueueStore.prototype.addRows = function addRowsWith50RowLimit(rows = []) {
  const incoming = Array.isArray(rows) ? rows : [];
  const current = this.read();
  const available = Math.max(0, MAX_AUTOMATION_ROWS - current.rows.length);
  if (incoming.length > available) {
    throw new Error(`Automation List can hold a maximum of ${MAX_AUTOMATION_ROWS} rows.`);
  }
  return previousAddRows.call(this, incoming);
};

FlyingResearchFeature.prototype.addToAutomation = async function addToAutomationWith50Rows({ keys = [], newChat = false } = {}) {
  const selected = [...new Set(Array.isArray(keys) ? keys : [])].slice(0, 200);
  const rows = [];
  const skippedItems = [];

  for (const key of selected) {
    try {
      const item = this.eligible(key);
      const queue = this.automationStore.read();
      const duplicate = queue.rows.some((row) => row.amazonLink === item.canonicalUrl)
        || rows.some((row) => row.amazonLink === item.canonicalUrl)
        || this.projects.findBySourceUrl(item.canonicalUrl).length;
      if (duplicate) throw new Error('Already in Automation List or Projects.');
      if (queue.rows.length + rows.length >= MAX_AUTOMATION_ROWS) {
        throw new Error(`Automation List is full (${MAX_AUTOMATION_ROWS} rows).`);
      }

      const source = await this.cacheImage(item);
      const id = crypto.randomUUID();
      const dir = path.join(app.getPath('userData'), 'automation-inputs', id);
      fs.mkdirSync(dir, { recursive: true });
      const referenceImage = path.join(dir, `reference${path.extname(source)}`);
      fs.copyFileSync(source, referenceImage);

      rows.push({
        id,
        enabled: true,
        referenceImage,
        amazonLink: item.canonicalUrl,
        newChat: Boolean(newChat),
        notes: '',
        status: 'pending',
        step: 'Waiting',
        checkpoint: 'input-ready',
        projectId: null,
        research: {
          source: 'flying-research',
          researchKey: key,
          asin: item.asin,
          marketplace: item.marketplace,
          title: item.title,
          sourceUrl: item.sourceUrl,
          capturedAt: item.capturedAt,
          bsr: item.bsr,
          estimatedSales30: item.estimatedSales30,
          verifiedBestSeller: false
        }
      });
    } catch (error) {
      skippedItems.push({ key, reason: error.message || String(error) });
    }
  }

  const current = this.automationStore.read();
  const accepted = [];
  for (const row of rows) {
    const full = current.rows.length + accepted.length >= MAX_AUTOMATION_ROWS;
    const duplicate = current.rows.some((existing) => existing.amazonLink === row.amazonLink)
      || accepted.some((existing) => existing.amazonLink === row.amazonLink);
    if (full || duplicate) {
      fs.rmSync(path.dirname(row.referenceImage), { recursive: true, force: true });
      skippedItems.push({
        key: row.research.researchKey,
        reason: full
          ? `Automation List is full (${MAX_AUTOMATION_ROWS} rows).`
          : 'Already in Automation List.'
      });
    } else {
      accepted.push(row);
    }
  }

  if (accepted.length) {
    this.automationStore.addRows(accepted);
    for (const row of accepted) {
      this.automationStore.updateRow(row.id, { newChat: row.newChat });
    }
  }

  return {
    added: accepted.length,
    rows: accepted.map((row) => ({ id: row.id, researchKey: row.research.researchKey })),
    skippedItems
  };
};

module.exports = { MAX_AUTOMATION_ROWS };
