const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULT_CATEGORIES = ['temporary','researchCache','thumbnails','logs','browserCache'];

async function exists(file) { try { await fsp.access(file); return true; } catch { return false; } }

async function sizeOf(target) {
  if (!target || !(await exists(target))) return 0;
  let stat;
  try { stat = await fsp.stat(target); } catch { return 0; }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  let entries = [];
  try { entries = await fsp.readdir(target, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) total += await sizeOf(path.join(target, entry.name));
  return total;
}

function unique(values) { return [...new Set(values.filter(Boolean).map((item) => path.resolve(item)))]; }

class StorageManager {
  constructor({ automationStore, projects }) {
    this.automationStore = automationStore;
    this.projects = projects;
  }

  root() { return app.getPath('userData'); }
  settingsFile() { return path.join(this.root(), 'storage-cleanup.json'); }
  readSettings() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile(), 'utf8'));
      return {
        cleanupInterval: raw.cleanupInterval || 'off',
        selectedCleanupCategories: Array.isArray(raw.selectedCleanupCategories) ? raw.selectedCleanupCategories : DEFAULT_CATEGORIES,
        lastCleanupAt: raw.lastCleanupAt || null,
        nextCleanupAt: raw.nextCleanupAt || null,
        lastCleanupRecoveredBytes: Number(raw.lastCleanupRecoveredBytes || 0),
        lastCleanupFilesRemoved: Number(raw.lastCleanupFilesRemoved || 0)
      };
    } catch {
      return { cleanupInterval: 'off', selectedCleanupCategories: [...DEFAULT_CATEGORIES], lastCleanupAt: null, nextCleanupAt: null, lastCleanupRecoveredBytes: 0, lastCleanupFilesRemoved: 0 };
    }
  }

  addInterval(date, interval) {
    const next = new Date(date);
    if (interval === '1d') next.setDate(next.getDate() + 1);
    else if (interval === '3d') next.setDate(next.getDate() + 3);
    else if (interval === '7d') next.setDate(next.getDate() + 7);
    else if (interval === '2w') next.setDate(next.getDate() + 14);
    else if (interval === '3w') next.setDate(next.getDate() + 21);
    else if (interval === 'monthly') next.setMonth(next.getMonth() + 1);
    else return null;
    return next;
  }

  withSchedule(settings = this.readSettings()) {
    if (settings.cleanupInterval === 'off') return { ...settings, nextCleanupAt: null };
    let next = settings.nextCleanupAt ? new Date(settings.nextCleanupAt) : null;
    if (!next || !Number.isFinite(next.getTime())) {
      const base = settings.lastCleanupAt ? new Date(settings.lastCleanupAt) : new Date();
      next = this.addInterval(base, settings.cleanupInterval);
    }
    return { ...settings, nextCleanupAt: next ? next.toISOString() : null };
  }

  writeSettings(patch) {
    const previous = this.readSettings();
    const next = { ...previous, ...patch };
    const intervalChanged = Object.prototype.hasOwnProperty.call(patch, 'cleanupInterval') && patch.cleanupInterval !== previous.cleanupInterval;
    const cleanupJustRan = Object.prototype.hasOwnProperty.call(patch, 'lastCleanupAt') && patch.lastCleanupAt;
    if (next.cleanupInterval === 'off') next.nextCleanupAt = null;
    else if (cleanupJustRan) {
      const scheduled = this.addInterval(new Date(patch.lastCleanupAt), next.cleanupInterval);
      next.nextCleanupAt = scheduled ? scheduled.toISOString() : null;
    } else if (intervalChanged || !next.nextCleanupAt) {
      const scheduled = this.addInterval(new Date(), next.cleanupInterval);
      next.nextCleanupAt = scheduled ? scheduled.toISOString() : null;
    }
    fs.mkdirSync(this.root(), { recursive: true });
    const temp = `${this.settingsFile()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
    fs.copyFileSync(temp, this.settingsFile());
    fs.rmSync(temp, { force: true });
    return this.withSchedule(next);
  }

  cacheTargets() {
    const root = this.root();
    const profiles = path.join(root, 'profiles');
    const browserCacheDirs = [];
    if (fs.existsSync(profiles)) {
      const profileRoots = fs.readdirSync(profiles, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(profiles, entry.name));
      const names = ['Cache','Code Cache','GPUCache','DawnCache','GrShaderCache','GraphiteDawnCache'];
      for (const profile of profileRoots) {
        for (const relative of ['', 'Default']) for (const name of names) browserCacheDirs.push(path.join(profile, relative, name));
      }
    }
    return {
      temporary: [path.join(root, 'temp'), path.join(root, 'tmp')],
      researchCache: [path.join(root, 'research', 'cache')],
      thumbnails: [path.join(root, 'research', 'thumbnails')],
      logs: [path.join(root, 'logs')],
      browserCache: browserCacheDirs,
      publishedCache: [path.join(root, 'publish-cache')],
      buildArtifacts: [path.join(root, 'build-artifacts')]
    };
  }

  protectedReferences() {
    const refs = [];
    const queue = this.automationStore.read();
    for (const row of queue.rows || []) {
      if (!['completed','skipped'].includes(row.status)) refs.push(row.referenceImage);
    }
    for (const project of this.projects.list({ includeArchived: true })) {
      refs.push(project.referencePath, project.generatedImagePath, project.approvedImagePath, project.vectorPath, project.finalPngPath, project.redbubble?.reviewScreenshotPath);
    }
    return unique(refs);
  }

  isBusy() {
    const queue = this.automationStore.read();
    if (queue.state === 'running' || queue.rows.some((row) => row.status === 'running')) return true;
    const active = new Set(['generating','regenerating','metadata-generating','vectorizing','vectorizer-manual-download','redbubble-preparing','redbubble-publish-pending']);
    return this.projects.list({ includeArchived: true }).some((project) => active.has(project.status));
  }

  async usage() {
    const root = this.root();
    const targets = this.cacheTargets();
    const browserDisposableCache = await this.sumTargets(targets.browserCache);
    const parts = {
      temporary: await this.sumTargets(targets.temporary),
      researchCache: await this.sumTargets(targets.researchCache),
      thumbnails: await this.sumTargets(targets.thumbnails),
      automationWorking: (await sizeOf(path.join(root, 'automation-inputs'))) + (await sizeOf(path.join(root, 'projects'))),
      browserDisposableCache,
      browserProfilesProtected: Math.max(0, (await sizeOf(path.join(root, 'profiles'))) - browserDisposableCache),
      logs: await this.sumTargets(targets.logs),
      publishedProjectCache: await this.sumTargets(targets.publishedCache),
      researchDatabase: (await sizeOf(path.join(root, 'research', 'research.json'))) + (await sizeOf(path.join(root, 'research', 'research.json.bak'))),
      appState: await this.sumTargets([
        path.join(root, 'automation-list.json'), path.join(root, 'automation-list.json.bak'), path.join(root, 'connections.bin'), path.join(root, 'thread-state.json'), this.settingsFile()
      ])
    };
    parts.total = Object.values(parts).reduce((sum, bytes) => sum + Number(bytes || 0), 0);
    return { ...parts, settings: this.withSchedule(), busy: this.isBusy() };
  }

  async sumTargets(targets) { let total = 0; for (const item of unique(targets || [])) total += await sizeOf(item); return total; }

  pathProtected(target, protectedRefs) {
    const resolved = path.resolve(target);
    return protectedRefs.some((ref) => {
      const p = path.resolve(ref);
      return p === resolved || p.startsWith(`${resolved}${path.sep}`) || resolved.startsWith(`${p}${path.sep}`);
    });
  }

  async clearDirectoryContents(dir, protectedRefs, result) {
    if (!(await exists(dir))) return;
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { result.failed += 1; return; }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (this.pathProtected(target, protectedRefs)) { result.protectedSkipped += 1; continue; }
      let bytes = 0;
      try { bytes = await sizeOf(target); await fsp.rm(target, { recursive: true, force: true }); result.filesRemoved += 1; result.bytesRecovered += bytes; }
      catch { result.failed += 1; }
    }
  }

  async cleanup(categories = DEFAULT_CATEGORIES, options = {}) {
    const chosen = [...new Set(categories || [])];
    const result = { filesRemoved: 0, bytesRecovered: 0, protectedSkipped: 0, failed: 0, skippedCategories: [], ranAt: new Date().toISOString() };
    const targets = this.cacheTargets();
    const protectedRefs = this.protectedReferences();
    const busy = this.isBusy();

    for (const category of chosen) {
      if (!targets[category]) continue;
      if (category === 'browserCache' && busy) { result.skippedCategories.push('browserCache (automation currently active)'); continue; }
      if (category === 'publishedCache' && !options.confirmPublishedCache) { result.skippedCategories.push('publishedCache (confirmation required)'); continue; }
      for (const dir of unique(targets[category])) await this.clearDirectoryContents(dir, protectedRefs, result);
    }

    this.writeSettings({ lastCleanupAt: result.ranAt, lastCleanupRecoveredBytes: result.bytesRecovered, lastCleanupFilesRemoved: result.filesRemoved });
    return { ...result, settings: this.withSchedule() };
  }

  async maybeRunScheduledCleanup() {
    const settings = this.withSchedule();
    if (settings.cleanupInterval === 'off' || !settings.nextCleanupAt) return { due: false };
    if (Date.now() < new Date(settings.nextCleanupAt).getTime()) return { due: false, nextCleanupAt: settings.nextCleanupAt };
    if (this.isBusy()) return { due: true, skipped: true, reason: 'automation-active' };
    return { due: true, result: await this.cleanup(settings.selectedCleanupCategories || DEFAULT_CATEGORIES) };
  }
}

module.exports = { StorageManager, DEFAULT_CATEGORIES, sizeOf };
