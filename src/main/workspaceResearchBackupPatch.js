const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { WorkspaceManager } = require('./workspaceManager');

const originalExportTo = WorkspaceManager.prototype.exportTo;
const originalRestoreFrom = WorkspaceManager.prototype.restoreFrom;

WorkspaceManager.prototype.exportTo = function exportWithResearch(destinationRoot) {
  const result = originalExportTo.call(this, destinationRoot);
  const backupDir = result.path;
  const userData = app.getPath('userData');
  const researchFile = path.join(userData, 'research', 'research.json');
  const storageSettings = path.join(userData, 'storage-cleanup.json');

  if (fs.existsSync(researchFile)) {
    const dest = path.join(backupDir, 'research');
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(researchFile, path.join(dest, 'research.json'));
  }
  if (fs.existsSync(storageSettings)) fs.copyFileSync(storageSettings, path.join(backupDir, 'storage-cleanup.json'));

  try {
    const manifestFile = path.join(backupDir, 'backup-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.version = Math.max(3, Number(manifest.version || 0));
    manifest.includes = [...new Set([...(manifest.includes || []), 'research database (when present)', 'storage cleanup settings (when present)'])];
    manifest.excludes = [...new Set([...(manifest.excludes || []), 'research image cache', 'browser session profiles', 'passwords', 'cookies', 'credentials'])];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
    result.manifest = manifest;
  } catch {}
  return result;
};

WorkspaceManager.prototype.restoreFrom = function restoreWithResearch(backupDir) {
  const result = originalRestoreFrom.call(this, backupDir);
  const userData = app.getPath('userData');
  const sourceResearch = path.join(backupDir, 'research', 'research.json');
  const sourceSettings = path.join(backupDir, 'storage-cleanup.json');
  let researchRestored = false;
  let storageSettingsRestored = false;

  if (fs.existsSync(sourceResearch)) {
    const destDir = path.join(userData, 'research');
    const destFile = path.join(destDir, 'research.json');
    fs.mkdirSync(destDir, { recursive: true });
    if (!fs.existsSync(destFile)) {
      fs.copyFileSync(sourceResearch, destFile);
      researchRestored = true;
    } else {
      try {
        const current = JSON.parse(fs.readFileSync(destFile, 'utf8'));
        const incoming = JSON.parse(fs.readFileSync(sourceResearch, 'utf8'));
        current.products = { ...(incoming.products || {}), ...(current.products || {}) };
        current.contexts = { ...(incoming.contexts || {}), ...(current.contexts || {}) };
        current.updatedAt = new Date().toISOString();
        const temp = `${destFile}.restore.tmp`;
        fs.writeFileSync(temp, JSON.stringify(current, null, 2), 'utf8');
        fs.copyFileSync(temp, destFile);
        fs.rmSync(temp, { force: true });
        researchRestored = true;
      } catch {}
    }
  }

  if (fs.existsSync(sourceSettings)) {
    const dest = path.join(userData, 'storage-cleanup.json');
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(sourceSettings, dest);
      storageSettingsRestored = true;
    }
  }

  return { ...result, researchRestored, storageSettingsRestored };
};

module.exports = {};
