const { app, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { SessionManager } = require('./sessionManager');
const { AutomateListFeature } = require('./automateListFeature');
const { sourceForUrl } = require('./automateListMultiMarketplacePatch');

const sessions = new SessionManager();
const feature = new AutomateListFeature({ sessions });

app.whenReady().then(() => {
  ipcMain.handle('automate-list:snapshot', () => feature.snapshot());

  ipcMain.handle('automate-list:import-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Upload mixed-marketplace POD product links',
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

  ipcMain.handle('automate-list:attach-image', async (_event, itemId) => {
    const file = await dialog.showOpenDialog({
      title: 'Choose a saved reference image for this product',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (file.canceled || !file.filePaths?.[0]) return { canceled: true };
    return { canceled: false, snapshot: await feature.attachReferenceImage(itemId, file.filePaths[0]) };
  });

  ipcMain.handle('automate-list:open-source', async (_event, itemId) => {
    const item = feature.snapshot().items.find((entry) => entry.id === itemId);
    if (!item || !sourceForUrl(item.url)) throw new Error('Invalid or unavailable source link.');
    await shell.openExternal(item.url);
    return { opened: true };
  });

  ipcMain.handle('automate-list:start', () => feature.start());
  ipcMain.handle('automate-list:pause', () => feature.pause());
  ipcMain.handle('automate-list:stop', () => feature.stop());
  ipcMain.handle('automate-list:retry-skipped', () => feature.retrySkipped());
  ipcMain.handle('automate-list:clear', () => feature.clear());
});

app.on('before-quit', () => {
  feature.stop();
  sessions.closeAll().catch(() => {});
});

module.exports = {};
