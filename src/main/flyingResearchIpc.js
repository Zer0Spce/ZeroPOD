const { app, ipcMain, shell } = require('electron');
const { SessionManager, SERVICES } = require('./sessionManager');
const { AutomationQueueStore } = require('./automationQueueStore');
const { ProjectStore } = require('./projectStore');
const { FlyingResearchFeature, ORIGIN } = require('./flyingResearchFeature');
const { MARKETPLACES } = require('./researchProvider');

SERVICES.flyingResearch = {
  name: 'Flying Research', url: ORIGIN,
  loginUrlPatterns: [/#\/user\/(?:login|sign-up|forgot-password)/i],
  loggedOutText: [/^Sign in$/i],
  authenticatedSelectors: ['#userSettings']
};
// Isolated profile and controller; existing generation and queue transports stay intact.
const sessions = new SessionManager();
const feature = new FlyingResearchFeature({ sessions, automationStore: new AutomationQueueStore(), projects: new ProjectStore() });
let pending = Promise.resolve();
const serialize = (action) => {
  const next = pending.then(action);
  pending = next.catch(() => {});
  return next;
};

app.whenReady().then(() => {
  ipcMain.handle('flying:options', () => feature.options());
  ipcMain.handle('flying:list', (_event, filters) => feature.list(filters || {}));
  ipcMain.handle('flying:save', (_event, payload) => feature.save(payload || {}));
  ipcMain.handle('flying:login', () => serialize(() => feature.login()));
  ipcMain.handle('flying:test', () => serialize(() => feature.test()));
  ipcMain.handle('flying:open', (_event, tool) => serialize(() => feature.open(tool)));
  ipcMain.handle('flying:search', (_event, payload) => serialize(() => feature.search(payload || {})));
  ipcMain.handle('flying:capture', () => serialize(() => feature.capture()));
  ipcMain.handle('flying:next-page', () => serialize(() => feature.loadNextPage()));
  ipcMain.handle('flying:workflow', (_event, key) => serialize(() => feature.workflow(key)));
  ipcMain.handle('flying:automation', (_event, payload) => serialize(() => feature.addToAutomation(payload || {})));
  ipcMain.handle('flying:amazon', async (_event, key) => {
    const item = feature.store.get(key);
    if (!item || !MARKETPLACES[item.marketplace]) throw new Error('Flying design was not found.');
    await shell.openExternal(`${MARKETPLACES[item.marketplace].baseUrl}/dp/${item.asin}`);
    return { ok: true };
  });
});
app.on('before-quit', () => sessions.closeAll().catch(() => {}));
