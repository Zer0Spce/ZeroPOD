const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const { SessionManager } = require('./sessionManager');
const { AutomateListFeature } = require('./automateListFeature');

const sessions = new SessionManager();
const feature = new AutomateListFeature({ sessions });

app.whenReady().then(() => {
  ipcMain.handle('automate-list:snapshot', () => feature.snapshot());

  ipcMain.handle('automate-list:import-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Upload Amazon POD link list',
      properties: ['openFile'],
      filters: [
        { name: 'Supported lists', extensions: ['xlsx', 'csv', 'tsv', 'txt', 'md', 'json', 'log'] },
        { name: 'Excel workbook', extensions: ['xlsx'] },
        { name: 'Text files', extensions: ['csv', 'tsv', 'txt', 'md', 'json', 'log'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const snapshot = await feature.importFile(result.filePaths[0]);
    return {
      canceled: false,
      fileName: path.basename(result.filePaths[0]),
      snapshot
    };
  });

  ipcMain.handle('automate-list:start', () => feature.start());
  ipcMain.handle('automate-list:pause', () => feature.pause());
  ipcMain.handle('automate-list:stop', () => feature.stop());
  ipcMain.handle('automate-list:clear', () => feature.clear());
});

app.on('before-quit', () => {
  feature.stop();
  sessions.closeAll().catch(() => {});
});

module.exports = {};
