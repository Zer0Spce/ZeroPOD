const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function rendererScript(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
}

function installFlyingResearchCache(window) {
  if (!window?.webContents) return;

  const inject = async () => {
    const currentUrl = window.webContents.getURL();
    if (!currentUrl || !currentUrl.startsWith('file:')) return;
    try {
      await window.webContents.executeJavaScript(rendererScript('flyingResearchCache.js'));
    } catch {}
  };

  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', inject);
  else inject();
}

app.on('browser-window-created', (_event, window) => installFlyingResearchCache(window));
app.whenReady().then(() => {
  for (const window of BrowserWindow.getAllWindows()) installFlyingResearchCache(window);
});

module.exports = { installFlyingResearchCache };
