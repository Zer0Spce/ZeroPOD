const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const CACHE_DIRECTORY_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'GrShaderCache',
  'ShaderCache',
  'CacheStorage'
]);

function clearKnownCacheDirectories(root, deleted = [], depth = 0) {
  if (!root || depth > 8 || !fs.existsSync(root)) return deleted;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return deleted; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    if (CACHE_DIRECTORY_NAMES.has(entry.name)) {
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        deleted.push(fullPath);
      } catch {}
      continue;
    }
    clearKnownCacheDirectories(fullPath, deleted, depth + 1);
  }
  return deleted;
}

app.whenReady().then(() => {
  ipcMain.removeHandler('app:clear-cache');
  ipcMain.handle('app:clear-cache', async () => {
    const windows = BrowserWindow.getAllWindows();
    await Promise.all(windows.map(async (win) => {
      try { await win.webContents.session.clearCache(); } catch {}
    }));

    const deleted = clearKnownCacheDirectories(app.getPath('userData'));
    return {
      ok: true,
      deletedCount: deleted.length,
      message: 'Cache cleared. Projects, theme settings, cookies, saved logins, and ZeroPOD workflow data were left intact.'
    };
  });
});
