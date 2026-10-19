const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function rendererScript(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
}

function installZeroPODRendererPatches(window) {
  if (!window?.webContents) return;

  const inject = async () => {
    const currentUrl = window.webContents.getURL();
    if (!currentUrl || !currentUrl.startsWith('file:')) return;

    try {
      await window.webContents.executeJavaScript(rendererScript('automationNewChat.js'));
      await window.webContents.executeJavaScript(rendererScript('sourceImageAutofetch.js'));
      await window.webContents.executeJavaScript(rendererScript('automationCapacity50.js'));
    } catch {}
  };

  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', inject);
  else inject();

  // One delayed verification handles slow renderer initialization without relying
  // on a dynamically inserted script tag or relative file URL resolution.
  setTimeout(() => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.executeJavaScript(`Boolean(document.getElementById('automationNewChatOption') && window.__zeroPODAutomationCapacity50Installed)`)
      .then((mounted) => { if (!mounted) inject(); })
      .catch(() => {});
  }, 2500);
}

app.on('browser-window-created', (_event, window) => installZeroPODRendererPatches(window));

app.whenReady().then(() => {
  for (const window of BrowserWindow.getAllWindows()) installZeroPODRendererPatches(window);
});

module.exports = { installZeroPODRendererPatches };
