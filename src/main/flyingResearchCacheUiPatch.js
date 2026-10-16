const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function rendererScript(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
}

async function rendererReady(window) {
  if (!window?.webContents || window.webContents.isDestroyed()) return false;
  const currentUrl = window.webContents.getURL();
  if (!currentUrl || !currentUrl.startsWith('file:')) return false;
  try {
    return Boolean(await window.webContents.executeJavaScript(
      'Boolean(window.zeroPOD?.flyingResearch && document.getElementById("flyingResearch") && document.getElementById("frCapture"))'
    ));
  } catch {
    return false;
  }
}

async function injectOnce(window) {
  if (!await rendererReady(window)) return false;
  try {
    const installed = await window.webContents.executeJavaScript('Boolean(window.__zeroPODFlyingCacheInstalled)');
    if (installed) return true;
    await window.webContents.executeJavaScript(rendererScript('flyingResearchCache.js'));
    return Boolean(await window.webContents.executeJavaScript('Boolean(window.__zeroPODFlyingCacheInstalled)'));
  } catch {
    return false;
  }
}

function installFlyingResearchCache(window) {
  if (!window?.webContents) return;

  let attempts = 0;
  let timer = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const tryInstall = async () => {
    if (!window?.webContents || window.webContents.isDestroyed()) {
      stop();
      return;
    }
    attempts += 1;
    if (await injectOnce(window)) {
      stop();
      return;
    }
    if (attempts >= 80) stop();
  };

  const start = () => {
    stop();
    attempts = 0;
    tryInstall().catch(() => {});
    timer = setInterval(() => tryInstall().catch(() => {}), 250);
  };

  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', start);
  else start();

  window.webContents.on('did-finish-load', start);
  window.on?.('closed', stop);
}

app.on('browser-window-created', (_event, window) => installFlyingResearchCache(window));
app.whenReady().then(() => {
  for (const window of BrowserWindow.getAllWindows()) installFlyingResearchCache(window);
});

module.exports = { installFlyingResearchCache, rendererReady, injectOnce };
