const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { RedbubbleController } = require('./redbubbleController');
const { ProjectStore } = require('./projectStore');
const { AutomationQueueStore } = require('./automationQueueStore');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const LEDGER_FILE = 'redbubble-publish-ledger.json';

function ledgerPath() {
  return path.join(app.getPath('userData'), LEDGER_FILE);
}

function emptyLedger() {
  return { version: 1, entries: [], updatedAt: null };
}

function normalizeEntry(entry = {}) {
  const publishedAt = new Date(entry.publishedAt || '').toISOString();
  return {
    id: String(entry.id || ''),
    projectId: entry.projectId || null,
    queueRowId: entry.queueRowId || null,
    publishedAt,
    publishedUrl: entry.publishedUrl || null,
    title: entry.title || null,
    source: entry.source || 'unknown'
  };
}

function readLedger() {
  try {
    const file = ledgerPath();
    if (!fs.existsSync(file)) return emptyLedger();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = Array.isArray(parsed.entries) ? parsed.entries.filter((entry) => {
      const value = Date.parse(entry?.publishedAt || '');
      return Number.isFinite(value);
    }) : [];
    return { version: 1, entries, updatedAt: parsed.updatedAt || null };
  } catch {
    return emptyLedger();
  }
}

function writeLedger(ledger) {
  const next = {
    version: 1,
    entries: Array.isArray(ledger.entries) ? ledger.entries : [],
    updatedAt: new Date().toISOString()
  };
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
  fs.copyFileSync(temp, file);
  fs.rmSync(temp, { force: true });
  return next;
}

function samePublish(left, right) {
  if (left.projectId && right.projectId && left.projectId === right.projectId) return true;
  if (left.queueRowId && right.queueRowId && left.queueRowId === right.queueRowId) return true;
  if (left.publishedUrl && right.publishedUrl && left.publishedUrl === right.publishedUrl) return true;
  if (left.id && right.id && left.id === right.id) return true;
  return false;
}

function upsertPublish(entry, ledger = readLedger()) {
  let normalized;
  try { normalized = normalizeEntry(entry); }
  catch { return { ledger, changed: false }; }

  if (!normalized.id) {
    normalized.id = normalized.projectId
      ? `project:${normalized.projectId}`
      : normalized.publishedUrl
        ? `url:${normalized.publishedUrl}`
        : normalized.queueRowId
          ? `queue:${normalized.queueRowId}`
          : `publish:${normalized.publishedAt}`;
  }

  const index = ledger.entries.findIndex((item) => samePublish(item, normalized));
  if (index >= 0) {
    const previous = ledger.entries[index];
    const merged = { ...previous, ...normalized, id: previous.id || normalized.id };
    if (JSON.stringify(previous) === JSON.stringify(merged)) return { ledger, changed: false };
    ledger.entries[index] = merged;
    return { ledger, changed: true };
  }

  ledger.entries.push(normalized);
  ledger.entries.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  return { ledger, changed: true };
}

function migrateKnownHistory() {
  const ledger = readLedger();
  let changed = false;

  try {
    const projects = new ProjectStore();
    for (const project of projects.list({ includeArchived: true })) {
      if (!project.redbubble?.publishedAt) continue;
      const result = upsertPublish({
        id: `project:${project.id}`,
        projectId: project.id,
        publishedAt: project.redbubble.publishedAt,
        publishedUrl: project.redbubble.publishedUrl || null,
        title: project.redbubble.title || project.metadata?.title || null,
        source: 'project-migration'
      }, ledger);
      changed = changed || result.changed;
    }
  } catch {}

  try {
    const queue = new AutomationQueueStore().read();
    for (const row of queue.rows || []) {
      if (row.status !== 'completed') continue;
      const publishedAt = row.completedAt || row.publishedAt || row.updatedAt;
      if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) continue;
      const result = upsertPublish({
        id: row.projectId ? `project:${row.projectId}` : row.publishedUrl ? `url:${row.publishedUrl}` : `queue:${row.id}`,
        projectId: row.projectId || null,
        queueRowId: row.id || null,
        publishedAt,
        publishedUrl: row.publishedUrl || null,
        title: row.listingTitle || null,
        source: 'automation-migration'
      }, ledger);
      changed = changed || result.changed;
    }
  } catch {}

  return changed ? writeLedger(ledger) : ledger;
}

function recordProjectPublish(project) {
  if (!project?.redbubble?.publishedAt) return readLedger();
  const ledger = readLedger();
  const result = upsertPublish({
    id: `project:${project.id}`,
    projectId: project.id,
    publishedAt: project.redbubble.publishedAt,
    publishedUrl: project.redbubble.publishedUrl || null,
    title: project.redbubble.title || project.metadata?.title || null,
    source: 'verified-publish'
  }, ledger);
  return result.changed ? writeLedger(result.ledger) : result.ledger;
}

function getPublishStats() {
  const ledger = migrateKnownHistory();
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = ledger.entries.filter((entry) => {
    const value = Date.parse(entry.publishedAt || '');
    return Number.isFinite(value) && value > cutoff && value <= now;
  });
  return {
    totalPublished: ledger.entries.length,
    last24h: recent.length,
    count: recent.length,
    localCount: recent.length,
    oldestInWindowAt: recent.length ? recent[0].publishedAt : null,
    latestPublishedAt: ledger.entries.length ? ledger.entries[ledger.entries.length - 1].publishedAt : null,
    ledgerFile: LEDGER_FILE
  };
}

const previousPublish = RedbubbleController.prototype.publish;
RedbubbleController.prototype.publish = async function publishWithPersistentLedger(projectId) {
  const result = await previousPublish.call(this, projectId);
  try {
    const project = this.projects.read(projectId);
    if ((result?.ok && result?.verified) || project.status === 'published') recordProjectPublish(project);
  } catch {}
  return result;
};

app.whenReady().then(() => {
  migrateKnownHistory();
  ipcMain.handle('redbubble:publish-ledger-stats', () => getPublishStats());
});

module.exports = {
  LEDGER_FILE,
  readLedger,
  writeLedger,
  migrateKnownHistory,
  recordProjectPublish,
  getPublishStats
};
