require('./spreadshirtMarketplaceRoutePatch');
require('./spreadshirtTrueHiddenChromePatch');

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function rendererScript(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
}

function installSpreadshirtAlpha(window) {
  if (!window?.webContents) return;
  const inject = async () => {
    const currentUrl = window.webContents.getURL();
    if (!currentUrl || !currentUrl.startsWith('file:')) return;
    try {
      await window.webContents.executeJavaScript(rendererScript('spreadshirtAlpha.js'));
      await window.webContents.executeJavaScript(rendererScript('spreadshirtRegularExportUiPatch.js'));
      await window.webContents.executeJavaScript(rendererScript('spreadshirtBetaPolish.js'));
      await window.webContents.executeJavaScript(rendererScript('automationPodTargetsUi.js'));
      await window.webContents.executeJavaScript(rendererScript('connectionsExtraServices.js'));
    } catch {}
  };

  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', inject);
  else inject();

  setTimeout(() => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.executeJavaScript(`Boolean(document.getElementById('spreadshirtAlpha')) && Boolean(window.__zeroPODAutomationTargetsInstalled) && Boolean(window.__zeroPODExtraConnectionsInstalled)`)
      .then((mounted) => { if (!mounted) inject(); })
      .catch(() => {});
  }, 2600);
}

app.on('browser-window-created', (_event, window) => installSpreadshirtAlpha(window));
app.whenReady().then(() => {
  for (const window of BrowserWindow.getAllWindows()) installSpreadshirtAlpha(window);
});

module.exports = { installSpreadshirtAlpha };
