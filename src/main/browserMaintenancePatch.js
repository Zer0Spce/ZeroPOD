const { app, ipcMain } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { StorageManager, sizeOf } = require('./storageManager');
const { AutomationQueueStore } = require('./automationQueueStore');
const { ProjectStore } = require('./projectStore');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const automationStore = new AutomationQueueStore();
const projects = new ProjectStore();
const storage = new StorageManager({ automationStore, projects });

function assertIdle() {
  if (storage.isBusy()) {
    throw new Error('Pause Automation and wait for the current workflow step to finish before resetting the hidden browser or clearing browser cache.');
  }
}

function profileRoot() {
  return path.join(app.getPath('userData'), 'profiles');
}

async function closeHiddenAutomationChrome() {
  if (process.platform !== 'win32') return { closedProcesses: 0 };

  const root = profileRoot().replace(/'/g, "''");
  const script = [
    `$root='${root}'`,
    "$items = @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match '--remote-debugging-port=' })",
    '$count = $items.Count',
    '$items | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    'Write-Output $count'
  ].join('; ');

  const output = await new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
      (_error, stdout) => resolve(String(stdout || '').trim())
    );
  });

  await wait(650);
  const count = Number.parseInt(output.split(/\s+/).pop() || '0', 10);
  return { closedProcesses: Number.isFinite(count) ? count : 0 };
}

async function removeCacheTarget(target, failures) {
  if (!target || !fs.existsSync(target)) return;
  try {
    await fsp.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
  } catch (error) {
    failures.push({ path: target, message: error.message || String(error) });
  }
}

async function clearBrowserCacheOnly() {
  assertIdle();
  const before = await storage.sumTargets(storage.browserCacheTargets());
  const closed = await closeHiddenAutomationChrome();
  const failures = [];

  for (const target of storage.browserCacheTargets()) {
    await removeCacheTarget(target, failures);
  }

  const after = await storage.sumTargets(storage.browserCacheTargets());
  return {
    ok: failures.length === 0,
    bytesBefore: before,
    bytesAfter: after,
    bytesRecovered: Math.max(0, before - after),
    failed: failures.length,
    failedTargets: failures.slice(0, 12),
    closedProcesses: closed.closedProcesses,
    preserved: ['cookies', 'saved logins', 'Local Storage', 'IndexedDB', 'browser profiles', 'ZeroPOD sessions']
  };
}

async function resetHiddenBrowser() {
  assertIdle();
  const result = await closeHiddenAutomationChrome();
  return {
    ok: true,
    closedProcesses: result.closedProcesses,
    message: result.closedProcesses
      ? `Closed ${result.closedProcesses} hidden automation browser process${result.closedProcesses === 1 ? '' : 'es'}. ZeroPOD will start a fresh hidden browser automatically when needed.`
      : 'No hidden automation browser was running. ZeroPOD will start one automatically when needed.',
    loginDataPreserved: true
  };
}

app.whenReady().then(() => {
  ipcMain.handle('browser:clear-cache-only', () => clearBrowserCacheOnly());
  ipcMain.handle('browser:reset-hidden', () => resetHiddenBrowser());
});

module.exports = { clearBrowserCacheOnly, resetHiddenBrowser, closeHiddenAutomationChrome };
