const { app, ipcMain } = require('electron');
const { SourceImageResolver } = require('./sourceImageResolver');

const resolver = new SourceImageResolver();

app.whenReady().then(() => {
  ipcMain.handle('source-image:resolve', async (_event, payload = {}) => {
    const url = typeof payload === 'string' ? payload : payload.url;
    return resolver.resolve(url);
  });
});

app.on('before-quit', () => {
  resolver.close().catch(() => {});
});

module.exports = { resolver };
