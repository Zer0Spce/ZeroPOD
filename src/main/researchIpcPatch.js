const { app, ipcMain } = require('electron');
const { SessionManager } = require('./sessionManager');
const { AutomationQueueStore } = require('./automationQueueStore');
const { ProjectStore } = require('./projectStore');
const { ResearchFeature } = require('./researchFeature');
const { StorageManager } = require('./storageManager');

// Deliberately separate service objects backed by the SAME persisted ZeroPOD stores.
// This module never replaces or wraps the current AutomationQueueController.
const researchSessions = new SessionManager();
const automationStore = new AutomationQueueStore();
const projects = new ProjectStore();
const research = new ResearchFeature({ sessions: researchSessions, automationStore, projects });
const storage = new StorageManager({ automationStore, projects });

app.whenReady().then(async () => {
  ipcMain.handle('research:list', (_event, filters) => research.list(filters || {}));
  ipcMain.handle('research:get', (_event, key) => research.get(key));
  ipcMain.handle('research:marketplaces', () => research.marketplaces());
  ipcMain.handle('research:presets', () => research.presets());
  ipcMain.handle('research:refresh-best-sellers', (_event, payload) => research.refreshBestSellers(payload || {}));
  ipcMain.handle('research:import-product', (_event, payload) => research.importProduct(payload || {}));
  ipcMain.handle('research:save', (_event, { key, saved }) => research.save(key, saved));
  ipcMain.handle('research:add-to-automation', (_event, keys) => research.addToAutomation(keys || []));
  ipcMain.handle('research:open-amazon', (_event, url) => research.openAmazon(url));

  ipcMain.handle('storage:usage', () => storage.usage());
  ipcMain.handle('storage:settings', () => storage.withSchedule());
  ipcMain.handle('storage:update-settings', (_event, patch) => storage.writeSettings(patch || {}));
  ipcMain.handle('storage:cleanup', (_event, payload = {}) => storage.cleanup(payload.categories || [], payload.options || {}));

  // Startup-only due check. It is intentionally non-blocking and never polls aggressively.
  setTimeout(() => storage.maybeRunScheduledCleanup().catch(() => {}), 2500);
});

app.on('before-quit', () => {
  researchSessions.closeAll().catch(() => {});
});

module.exports = {};
