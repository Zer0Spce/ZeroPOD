const { screen } = require('electron');
const { execFile } = require('child_process');
const { SessionManager } = require('./sessionManager');

const originalEnsureService = SessionManager.prototype.ensureService;
const originalCloseAutomationContext = SessionManager.prototype.closeAutomationContext;
const originalLaunchNormalLoginBrowser = SessionManager.prototype.launchNormalLoginBrowser;

const dockStates = new WeakMap();

function stateMap(manager) {
  let map = dockStates.get(manager);
  if (!map) {
    map = new Map();
    dockStates.set(manager, map);
  }
  return map;
}

function stopDock(manager, serviceId) {
  const map = stateMap(manager);
  const state = map.get(serviceId);
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  if (state.session) state.session.detach().catch(() => {});
  map.delete(serviceId);
}

function computeDockBounds(manager) {
  const host = manager.__zeroPodHostWindow;
  let display;
  try {
    display = host && !host.isDestroyed()
      ? screen.getDisplayMatching(host.getBounds())
      : screen.getPrimaryDisplay();
  } catch {
    display = screen.getPrimaryDisplay();
  }

  const work = display.workArea;
  const minBrowserWidth = 520;
  const minHostWidth = 760;
  let browserWidth = Math.round(work.width * 0.40);
  browserWidth = Math.max(minBrowserWidth, Math.min(browserWidth, work.width - minHostWidth));
  if (browserWidth < 420) browserWidth = Math.max(420, Math.round(work.width * 0.36));
  const hostWidth = Math.max(1, work.width - browserWidth);

  return {
    host: { x: work.x, y: work.y, width: hostWidth, height: work.height },
    browser: { x: work.x + hostWidth, y: work.y, width: browserWidth, height: work.height }
  };
}

function dockHost(manager, bounds) {
  const host = manager.__zeroPodHostWindow;
  if (!host || host.isDestroyed()) return;
  try {
    if (host.isMaximized()) host.unmaximize();
    host.setBounds(bounds.host, false);
  } catch {}
}

async function dockAutomationPage(manager, serviceId, page) {
  if (!page || page.isClosed()) return;
  const map = stateMap(manager);
  const existing = map.get(serviceId);
  if (existing?.page === page && existing?.session) {
    dockHost(manager, computeDockBounds(manager));
    return;
  }

  stopDock(manager, serviceId);

  let session;
  let windowId;
  try {
    session = await page.context().newCDPSession(page);
    const result = await session.send('Browser.getWindowForTarget');
    windowId = result?.windowId;
    if (!windowId) throw new Error('Chrome window id unavailable');
  } catch {
    if (session) await session.detach().catch(() => {});
    return;
  }

  const apply = async () => {
    if (page.isClosed()) {
      stopDock(manager, serviceId);
      return;
    }
    const bounds = computeDockBounds(manager);
    dockHost(manager, bounds);
    try {
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    } catch {}
    try {
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: Math.round(bounds.browser.x),
          top: Math.round(bounds.browser.y),
          width: Math.round(bounds.browser.width),
          height: Math.round(bounds.browser.height)
        }
      });
    } catch {}
  };

  await apply();
  const timer = setInterval(() => { apply().catch(() => {}); }, 1200);
  timer.unref?.();
  map.set(serviceId, { page, session, windowId, timer });
}

async function dockNativeLoginChrome(manager, serviceId) {
  if (process.platform !== 'win32') return;
  const bounds = computeDockBounds(manager);
  dockHost(manager, bounds);
  const profile = manager.getProfilePath(serviceId).replace(/'/g, "''");
  const b = bounds.browser;
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class ZeroPODDock {',
    '  [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool repaint);',
    '}',
    '"@',
    `$profile='${profile}'`,
    `$candidates = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) }`,
    '$window = $null',
    'foreach ($c in $candidates) { $p = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { $window = $p; break } }',
    `if ($window) { [ZeroPODDock]::MoveWindow($window.MainWindowHandle, ${Math.round(b.x)}, ${Math.round(b.y)}, ${Math.round(b.width)}, ${Math.round(b.height)}, $true) | Out-Null }`
  ].join("\n");

  await new Promise((resolve) => execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true },
    () => resolve()
  ));
}

SessionManager.prototype.setHostWindow = function setHostWindow(window) {
  this.__zeroPodHostWindow = window;

  // Beta-only convenience: if ChatGPT was already verified in ZeroPOD, reopen
  // that exact saved Chrome profile shortly after the app starts so the browser
  // is already attached and docked on the right. Do nothing for unverified/login
  // profiles so this cannot interfere with the normal native-login handoff.
  if (!this.__zeroPodBetaChatGPTScheduled) {
    this.__zeroPodBetaChatGPTScheduled = true;
    setTimeout(async () => {
      try {
        const status = this.getStatuses()?.chatgpt;
        if (!status?.connected) return;
        const { page } = await this.ensureService('chatgpt');
        await page.bringToFront().catch(() => {});
      } catch {}
    }, 900);
  }

  return this;
};

SessionManager.prototype.ensureService = async function ensureServiceDocked(serviceId) {
  const result = await originalEnsureService.call(this, serviceId);
  await dockAutomationPage(this, serviceId, result.page).catch(() => {});
  return result;
};

SessionManager.prototype.closeAutomationContext = async function closeAutomationContextDocked(serviceId) {
  stopDock(this, serviceId);
  return originalCloseAutomationContext.call(this, serviceId);
};

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserDocked(serviceId) {
  const result = await originalLaunchNormalLoginBrowser.call(this, serviceId);
  setTimeout(() => { dockNativeLoginChrome(this, serviceId).catch(() => {}); }, 650);
  setTimeout(() => { dockNativeLoginChrome(this, serviceId).catch(() => {}); }, 1600);
  return result;
};

module.exports = {};
