const { app, ipcMain } = require('electron');
const { performanceMetrics } = require('./performanceMetrics');

app.whenReady().then(() => {
  ipcMain.handle('performance:snapshot', () => performanceMetrics.snapshot());
});

module.exports = {};
