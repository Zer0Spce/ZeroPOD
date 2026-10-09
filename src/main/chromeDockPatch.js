const { screen } = require('electron');
const { execFile } = require('child_process');
const { SessionManager } = require('./sessionManager');

const originalEnsureService = SessionManager.prototype.ensureService;
const originalCloseAutomationContext = SessionManager.prototype.closeAutomationContext;
const originalLaunchNormalLoginBrowser = SessionManager.prototype.launchNormalLoginBrowser;

const dockStates = new WeakMap();
const wideServiceStates = new WeakMap();

function stateMap(manager) {
  let map = dockStates.get(manager);
  if (!map) {
    map = new Map();
    dockStates.set(manager, map);
  }
  return map;
}

function wideServices(manager) {
  let set = wideServiceStates.get(manager);
  if (!set) {
    set = new Set();
    wideServiceStates.set(manager, set);
  }
  return set;
}

function stopDock(manager, serviceId) {
  const map = stateMap(manager);
  const state = map.get(serviceId);
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  if (state.session) state.session.detach().catch(() => {});
  map.delete(serviceId);
}

function displayWorkArea(manager) {
  const host = manager.__zeroPodHostWindow;
  let display;
  try {
    display = host && !host.isDestroyed()
      ? screen.getDisplayMatching(host.getBounds())
      : screen.getPrimaryDisplay();
  } catch {
    display = screen.getPrimaryDisplay();
  }
  return display.workArea;
}

function computeDockBounds(manager) {
  const work = displayWorkArea(manager);
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

function keepHostVisibleInFront(manager) {
  const host = manager.__zeroPodHostWindow;
  if (!host || host.isDestroyed()) return;
  try {
    if (host.isMinimized()) host.restore();
    if (manager.__zeroPodHostWasAlwaysOnTop === undefined) {
      manager.__zeroPodHostWasAlwaysOnTop = !!host.isAlwaysOnTop?.();
    }
    host.setAlwaysOnTop(true, 'floating');
    host.show();
    host.moveTop?.();
  } catch {}
}

function restoreHostLayer(manager) {
  const host = manager.__zeroPodHostWindow;
  if (!host || host.isDestroyed()) return;
  try {
    host.setAlwaysOnTop(!!manager.__zeroPodHostWasAlwaysOnTop);
  } catch {}
  delete manager.__zeroPodHostWasAlwaysOnTop;
}

async function createChromeWindowSession(page) {
  let session;
  try {
    session = await page.context().newCDPSession(page);
    const result = await session.send('Browser.getWindowForTarget');
    const windowId = result?.windowId;
    if (!windowId) throw new Error('Chrome window id unavailable');
    return { session, windowId };
  } catch (error) {
    if (session) await session.detach().catch(() => {});
    throw error;
  }
}

async function wideAutomationPage(manager, serviceId, page) {
  if (!page || page.isClosed()) return;
  const map = stateMap(manager);
  const existing = map.get(serviceId);
  if (existing?.page === page && existing?.session && existing?.mode === 'wide') {
    keepHostVisibleInFront(manager);
    return;
  }

  stopDock(manager, serviceId);

  let chrome;
  try {
    chrome = await createChromeWindowSession(page);
  } catch {
    return;
  }

  const apply = async () => {
    if (page.isClosed()) {
      stopDock(manager, serviceId);
      restoreHostLayer(manager);
      return;
    }

    const work = displayWorkArea(manager);
    try {
      await chrome.session.send('Browser.setWindowBounds', {
        windowId: chrome.windowId,
        bounds: { windowState: 'normal' }
      });
    } catch {}
    try {
      await chrome.session.send('Browser.setWindowBounds', {
        windowId: chrome.windowId,
        bounds: {
          left: Math.round(work.x),
          top: Math.round(work.y),
          width: Math.round(work.width),
          height: Math.round(work.height)
        }
      });
    } catch {}

    // Redbubble gets the full browser viewport behind the app, while ZeroPOD
    // remains visibly in front so live workflow status/errors are still readable.
    keepHostVisibleInFront(manager);
  };

  await apply();
  const timer = setInterval(() => { apply().catch(() => {}); }, 1000);
  timer.unref?.();
  map.set(serviceId, { page, session: chrome.session, windowId: chrome.windowId, timer, mode: 'wide' });
}

async function dockAutomationPage(manager, serviceId, page) {
  if (!page || page.isClosed()) return;

  if (wideServices(manager).has(serviceId)) {
    await wideAutomationPage(manager, serviceId, page);
    return;
  }

  const map = stateMap(manager);
  const existing = map.get(serviceId);
  if (existing?.page === page && existing?.session && existing?.mode === 'dock') {
    dockHost(manager, computeDockBounds(manager));
    return;
  }

  stopDock(manager, serviceId);

  let chrome;
  try {
    chrome = await createChromeWindowSession(page);
  } catch {
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
      await chrome.session.send('Browser.setWindowBounds', { windowId: chrome.windowId, bounds: { windowState: 'normal' } });
    } catch {}
    try {
      await chrome.session.send('Browser.setWindowBounds', {
        windowId: chrome.windowId,
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
  map.set(serviceId, { page, session: chrome.session, windowId: chrome.windowId, timer, mode: 'dock' });
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

SessionManager.prototype.beginWideService = async function beginWideService(serviceId) {
  wideServices(this).add(serviceId);
  const existing = stateMap(this).get(serviceId);
  if (existing?.page && !existing.page.isClosed()) {
    await wideAutomationPage(this, serviceId, existing.page).catch(() => {});
  }
  keepHostVisibleInFront(this);
  return true;
};

SessionManager.prototype.endWideService = async function endWideService(serviceId) {
  wideServices(this).delete(serviceId);
  const existing = stateMap(this).get(serviceId);
  const page = existing?.page && !existing.page.isClosed() ? existing.page : null;
  stopDock(this, serviceId);
  restoreHostLayer(this);
  if (page) await dockAutomationPage(this, serviceId, page).catch(() => {});
  return true;
};

SessionManager.prototype.ensureService = async function ensureServiceDocked(serviceId) {
  const result = await originalEnsureService.call(this, serviceId);
  if (wideServices(this).has(serviceId)) {
    await wideAutomationPage(this, serviceId, result.page).catch(() => {});
  } else {
    await dockAutomationPage(this, serviceId, result.page).catch(() => {});
  }
  return result;
};

SessionManager.prototype.closeAutomationContext = async function closeAutomationContextDocked(serviceId) {
  wideServices(this).delete(serviceId);
  stopDock(this, serviceId);
  restoreHostLayer(this);
  return originalCloseAutomationContext.call(this, serviceId);
};

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserDocked(serviceId) {
  const result = await originalLaunchNormalLoginBrowser.call(this, serviceId);
  setTimeout(() => { dockNativeLoginChrome(this, serviceId).catch(() => {}); }, 650);
  setTimeout(() => { dockNativeLoginChrome(this, serviceId).catch(() => {}); }, 1600);
  return result;
};

module.exports = {};
