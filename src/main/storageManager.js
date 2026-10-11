const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Browser data is intentionally NOT a cleanup category. Clear Cache only removes
// known ZeroPOD temporary/unused files and never touches browser profiles,
// Chromium cache, cookies, Local Storage, IndexedDB, saved logins or sessions.
const SAFE_CATEGORIES = ['temporary','researchCache','thumbnails','logs','publishedCache','buildArtifacts'];
const DEFAULT_CATEGORIES = ['temporary','researchCache','thumbnails','logs','buildArtifacts'];
const BROWSER_CACHE_DIR_NAMES = ['Cache','Code Cache','GPUCache','DawnCache','DawnGraphiteCache','GrShaderCache','GraphiteDawnCache','ShaderCache','Media Cache'];

async function exists(file) { try { await fsp.access(file); return true; } catch { return false; } }
async function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
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
function unique(values) { return [...new Set((values || []).filter(Boolean).map((item) => path.resolve(item)))]; }
function sanitizeCategories(values, fallback = DEFAULT_CATEGORIES) {
  if (!Array.isArray(values)) return [...fallback];
  return [...new Set(values.filter((value) => SAFE_CATEGORIES.includes(value)))];
}

class StorageManager {
  constructor({ automationStore, projects }) { this.automationStore = automationStore; this.projects = projects; }
  root() { return app.getPath('userData'); }
  settingsFile() { return path.join(this.root(), 'storage-cleanup.json'); }

  readSettings() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile(), 'utf8'));
      return {
        cleanupInterval: raw.cleanupInterval || 'off',
        selectedCleanupCategories: sanitizeCategories(raw.selectedCleanupCategories),
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
    const cleanPatch = { ...patch };
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'selectedCleanupCategories')) cleanPatch.selectedCleanupCategories = sanitizeCategories(cleanPatch.selectedCleanupCategories, []);
    const next = { ...previous, ...cleanPatch };
    const intervalChanged = Object.prototype.hasOwnProperty.call(cleanPatch, 'cleanupInterval') && cleanPatch.cleanupInterval !== previous.cleanupInterval;
    const cleanupJustRan = Object.prototype.hasOwnProperty.call(cleanPatch, 'lastCleanupAt') && cleanPatch.lastCleanupAt;
    if (next.cleanupInterval === 'off') next.nextCleanupAt = null;
    else if (cleanupJustRan) {
      const scheduled = this.addInterval(new Date(cleanPatch.lastCleanupAt), next.cleanupInterval);
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

  browserProfileRoots() {
    const profiles = path.join(this.root(), 'profiles');
    if (!fs.existsSync(profiles)) return [];
    const roots = [];
    let services = [];
    try { services = fs.readdirSync(profiles, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { return roots; }
    for (const service of services) {
      const serviceRoot = path.join(profiles, service.name);
      roots.push(serviceRoot);
      let children = [];
      try { children = fs.readdirSync(serviceRoot, { withFileTypes: true }); } catch { continue; }
      for (const child of children) {
        if (!child.isDirectory()) continue;
        if (child.name === 'Default' || /^Profile\s+\d+$/i.test(child.name) || child.name === 'Guest Profile') roots.push(path.join(serviceRoot, child.name));
      }
    }
    return unique(roots);
  }

  browserCacheTargets() {
    const targets = [];
    for (const profileRoot of this.browserProfileRoots()) {
      for (const name of BROWSER_CACHE_DIR_NAMES) targets.push(path.join(profileRoot, name));
      targets.push(path.join(profileRoot, 'Service Worker', 'CacheStorage'));
      targets.push(path.join(profileRoot, 'Service Worker', 'ScriptCache'));
    }
    return unique(targets);
  }

  cacheTargets() {
    const root = this.root();
    return {
      temporary: [path.join(root, 'temp'), path.join(root, 'tmp')],
      researchCache: [path.join(root, 'research', 'cache')],
      thumbnails: [path.join(root, 'research', 'thumbnails')],
      logs: [path.join(root, 'logs')],
      publishedCache: [path.join(root, 'publish-cache')],
      buildArtifacts: [path.join(root, 'build-artifacts')]
    };
  }

  protectedReferences() {
    const refs = [];
    const queue = this.automationStore.read();
    for (const row of queue.rows || []) if (!['completed','skipped'].includes(row.status)) refs.push(row.referenceImage);
    for (const project of this.projects.list({ includeArchived: true })) refs.push(project.referencePath, project.generatedImagePath, project.approvedImagePath, project.vectorPath, project.finalPngPath, project.redbubble?.reviewScreenshotPath);
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
    const browserDisposableCache = await this.sumTargets(this.browserCacheTargets());
    const fullBrowserProfiles = await sizeOf(path.join(root, 'profiles'));
    const parts = {
      temporary: await this.sumTargets(targets.temporary),
      researchCache: await this.sumTargets(targets.researchCache),
      thumbnails: await this.sumTargets(targets.thumbnails),
      automationWorking: (await sizeOf(path.join(root, 'automation-inputs'))) + (await sizeOf(path.join(root, 'projects'))),
      browserDisposableCache,
      browserProfilesProtected: Math.max(0, fullBrowserProfiles - browserDisposableCache),
      browserTotalProtected: fullBrowserProfiles,
      logs: await this.sumTargets(targets.logs),
      publishedProjectCache: await this.sumTargets(targets.publishedCache),
      buildArtifacts: await this.sumTargets(targets.buildArtifacts),
      researchDatabase: (await sizeOf(path.join(root, 'research', 'research.json'))) + (await sizeOf(path.join(root, 'research', 'research.json.bak'))),
      appState: await this.sumTargets([path.join(root, 'automation-list.json'), path.join(root, 'automation-list.json.bak'), path.join(root, 'connections.bin'), path.join(root, 'thread-state.json'), this.settingsFile()])
    };
    parts.total = Object.values(parts).reduce((sum, bytes) => sum + Number(bytes || 0), 0);
    return { ...parts, settings: this.withSchedule(), busy: this.isBusy(), browserCleanupProtected: true };
  }

  async sumTargets(targets) { let total = 0; for (const item of unique(targets || [])) total += await sizeOf(item); return total; }
  pathProtected(target, protectedRefs) {
    const resolved = path.resolve(target);
    return protectedRefs.some((ref) => { const p = path.resolve(ref); return p === resolved || p.startsWith(`${resolved}${path.sep}`) || resolved.startsWith(`${p}${path.sep}`); });
  }
  rememberFailure(target, result) { result.failed += 1; if (result.failedPaths.length < 12) result.failedPaths.push(target); }

  async removeDisposableTarget(target, protectedRefs, result) {
    if (this.pathProtected(target, protectedRefs)) { result.protectedSkipped += 1; return; }
    const bytes = await sizeOf(target);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { await fsp.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 80 }); result.filesRemoved += 1; result.bytesRecovered += bytes; return; }
      catch { if (attempt < 2) await wait(120 * (attempt + 1)); }
    }
    let stat = null;
    try { stat = await fsp.stat(target); } catch { return; }
    if (stat.isDirectory()) { await this.clearDirectoryContents(target, protectedRefs, result); try { await fsp.rmdir(target); } catch {} return; }
    this.rememberFailure(target, result);
  }

  async clearDirectoryContents(dir, protectedRefs, result) {
    if (!(await exists(dir))) return;
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { this.rememberFailure(dir, result); return; }
    for (const entry of entries) await this.removeDisposableTarget(path.join(dir, entry.name), protectedRefs, result);
  }

  async cleanup(categories = DEFAULT_CATEGORIES, options = {}) {
    const requested = [...new Set(categories || [])];
    const chosen = sanitizeCategories(requested, []);
    const result = { filesRemoved: 0, bytesRecovered: 0, protectedSkipped: 0, failed: 0, failedPaths: [], skippedCategories: [], ranAt: new Date().toISOString() };
    for (const category of requested) if (!SAFE_CATEGORIES.includes(category)) result.skippedCategories.push(`${category} (protected / not a cleanup target)`);
    const targets = this.cacheTargets();
    const protectedRefs = this.protectedReferences();
    for (const category of chosen) {
      if (category === 'publishedCache' && !options.confirmPublishedCache) { result.skippedCategories.push('publishedCache (confirmation required)'); continue; }
      for (const dir of unique(targets[category] || [])) await this.clearDirectoryContents(dir, protectedRefs, result);
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
