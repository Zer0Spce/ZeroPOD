const { app, ipcMain, BrowserWindow } = require('electron');
const { performanceMetrics } = require('./performanceMetrics');

function installDashboardScript(window) {
  if (!window?.webContents) return;
  const inject = () => window.webContents.executeJavaScript(`(() => {
    if (document.querySelector('script[data-zeropod-performance]')) return;
    const script = document.createElement('script');
    script.src = 'performanceDashboard.js';
    script.dataset.zeropodPerformance = '1';
    document.body.appendChild(script);
  })()`).catch(() => {});

  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', inject);
  else inject();
}

app.on('browser-window-created', (_event, window) => installDashboardScript(window));

app.whenReady().then(() => {
  ipcMain.handle('performance:snapshot', () => performanceMetrics.snapshot());
  for (const window of BrowserWindow.getAllWindows()) installDashboardScript(window);
});

module.exports = { installDashboardScript };
