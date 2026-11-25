const { app, ipcMain } = require('electron');
const { SessionManager, SERVICES } = require('./sessionManager');
const { ProjectStore } = require('./projectStore');
const {
  SpreadshirtAlphaFeature,
  SPREADSHIRT_DESIGNS_URL
} = require('./spreadshirtAlphaFeature');

SERVICES.spreadshirt = {
  name: 'Spreadshirt',
  url: SPREADSHIRT_DESIGNS_URL,
  loginUrlPatterns: [/\/(?:login|signin|sign-in|register)(?:[/?#]|$)/i],
  loggedOutText: [/^sign in$/i, /^log in$/i, /^register$/i, /^create account$/i],
  authenticatedSelectors: [
    'a[href*="/designs" i]',
    'a[href*="/showroom" i]',
    'a[href*="/statistics" i]',
    '[data-testid*="account" i]',
    'nav a[href*="/account" i]'
  ]
};

const sessions = new SessionManager();
const projects = new ProjectStore();
const feature = new SpreadshirtAlphaFeature({ sessions, projects });
let pending = Promise.resolve();

function serialize(action) {
  const next = pending.then(action);
  pending = next.catch(() => {});
  return next;
}

app.whenReady().then(() => {
  ipcMain.handle('spreadshirt:login', () => serialize(() => feature.login()));
  ipcMain.handle('spreadshirt:test', () => serialize(() => feature.test()));
  ipcMain.handle('spreadshirt:open', () => serialize(() => feature.open()));
  ipcMain.handle('spreadshirt:mark-project', (_event, payload) => feature.markProject(payload.projectId, payload.source || {}));
  ipcMain.handle('spreadshirt:derive-metadata', (_event, projectId) => feature.deriveMetadata(projectId));
  ipcMain.handle('spreadshirt:save-metadata', (_event, payload) => feature.saveMetadata(payload.projectId, payload.metadata || {}));
  ipcMain.handle('spreadshirt:export-png', (_event, projectId) => serialize(() => feature.renderSpreadshirtPng(projectId)));
  ipcMain.handle('spreadshirt:check', (_event, projectId) => serialize(() => feature.check(projectId)));
  ipcMain.handle('spreadshirt:prepare', (_event, projectId) => serialize(() => feature.prepare(projectId)));
  ipcMain.handle('spreadshirt:publish', (_event, projectId) => serialize(() => feature.publish(projectId)));
  ipcMain.handle('spreadshirt:usage', () => feature.usage());
  ipcMain.handle('spreadshirt:settings', () => feature.readSettings());
  ipcMain.handle('spreadshirt:update-settings', (_event, patch) => feature.updateSettings(patch || {}));
});

app.on('before-quit', () => sessions.closeAll().catch(() => {}));

module.exports = { feature };

// Loaded here (before main.js constructs AutomationQueueController) so every
// Automation row can route its finished artwork to Redbubble, Spreadshirt, or both.
require('./automationPodTargetsPatch');
