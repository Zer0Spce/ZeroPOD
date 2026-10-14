const { execFile } = require('child_process');
const { SessionManager } = require('./sessionManager');
const { feature } = require('./spreadshirtAlphaIpc');
const { keepAutomationWindowOffscreen, showAutomationWindow } = require('./chromeDockPatch');

function psEscape(value) {
  return String(value || '').replace(/'/g, "''");
}

function runWindowCommand(profilePath, mode = 'hide', watchMs = 0) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'non-windows' });
  const profile = psEscape(profilePath);
  if (!profile) return Promise.resolve({ ok: false, reason: 'missing-profile' });

  const show = mode === 'show';
  const duration = Math.max(0, Number(watchMs) || 0);
  const script = [
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class ZeroPodHideWin32 {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);',
    '}',
    "'@",
    `$profile='${profile}'`,
    `$deadline=(Get-Date).AddMilliseconds(${duration})`,
    '$found=$false',
    'do {',
    '  $rows=@(Get-CimInstance Win32_Process | Where-Object {',
    "    ($_.Name -ieq 'chrome.exe' -or $_.Name -ieq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains($profile)",
    '  })',
    '  foreach ($row in $rows) {',
    '    $proc=Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue',
    '    if (-not $proc -or $proc.MainWindowHandle -eq 0) { continue }',
    '    $found=$true',
    show
      ? '    [ZeroPodHideWin32]::ShowWindowAsync($proc.MainWindowHandle,9) | Out-Null; [ZeroPodHideWin32]::BringWindowToTop($proc.MainWindowHandle) | Out-Null; [ZeroPodHideWin32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null'
      : '    [ZeroPodHideWin32]::ShowWindowAsync($proc.MainWindowHandle,0) | Out-Null',
    '  }',
    show ? '  break' : '  if ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 120 }',
    `} while ((Get-Date) -lt $deadline${duration > 0 ? '' : ' -and -not $found'})`,
    show ? 'if ($found) { Write-Output "SHOWN" } else { Write-Output "NO_WINDOW" }' : 'if ($found) { Write-Output "HIDDEN" } else { Write-Output "NO_WINDOW" }'
  ].join('\n');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: Math.max(5000, duration + 4000) },
      (error, stdout) => {
        const output = String(stdout || '').trim();
        if (error) return resolve({ ok: false, reason: 'powershell-window-command-failed', message: error.message || String(error) });
        resolve({ ok: show ? /SHOWN/i.test(output) : /HIDDEN/i.test(output), reason: /NO_WINDOW/i.test(output) ? 'window-not-found' : null, output });
      }
    );
  });
}

function hideChromeWindowByProfile(profilePath, watchMs = 0) {
  return runWindowCommand(profilePath, 'hide', watchMs);
}

function showChromeWindowByProfile(profilePath) {
  return runWindowCommand(profilePath, 'show', 0);
}

const previousEnsureService = SessionManager.prototype.ensureService;
SessionManager.prototype.ensureService = async function ensureServiceWithNativeSpreadshirtHide(serviceId) {
  const manualOpen = serviceId === 'spreadshirt' && Boolean(this.__zeroPodSpreadshirtManualOpen);
  const profilePath = serviceId === 'spreadshirt' ? this.getProfilePath(serviceId) : null;

  // Start hiding before Playwright launches so a brand-new automation browser never
  // gets a chance to sit behind ZeroPOD or appear in the taskbar during startup.
  if (serviceId === 'spreadshirt' && !manualOpen) {
    hideChromeWindowByProfile(profilePath, 9000).catch(() => {});
  }

  const result = await previousEnsureService.call(this, serviceId);
  if (serviceId === 'spreadshirt' && !manualOpen) {
    this.setAutomationWindowVisible?.(serviceId, false);
    await keepAutomationWindowOffscreen(result.page).catch(() => {});
    await hideChromeWindowByProfile(profilePath).catch(() => {});
  }
  return result;
};

const previousFocusAutomationWindow = SessionManager.prototype.focusAutomationWindow;
SessionManager.prototype.focusAutomationWindow = async function focusAutomationWindowWithNativeSpreadshirtHide(serviceId, suppliedPage = null) {
  if (serviceId !== 'spreadshirt' || this.__zeroPodSpreadshirtManualOpen) {
    return previousFocusAutomationWindow.call(this, serviceId, suppliedPage);
  }

  let page = suppliedPage;
  if (!page || page.isClosed?.()) {
    const result = await this.ensureService(serviceId);
    page = result.page;
  }
  this.setAutomationWindowVisible?.(serviceId, false);
  await keepAutomationWindowOffscreen(page).catch(() => {});
  const native = await hideChromeWindowByProfile(this.getProfilePath(serviceId)).catch(() => null);
  return { ok: true, hidden: true, nativeHidden: Boolean(native?.ok), native };
};

// Keep the explicit Open Spreadshirt button useful. Automatic runs stay hidden,
// but a user-requested Open action intentionally restores and focuses the window.
const previousOpen = feature.open.bind(feature);
feature.open = async function openSpreadshirtExplicitlyVisible() {
  this.sessions.__zeroPodSpreadshirtManualOpen = true;
  try {
    const result = await previousOpen();
    const { page } = await this.sessions.ensureService('spreadshirt');
    this.sessions.setAutomationWindowVisible?.('spreadshirt', true);
    await showAutomationWindow(page).catch(() => {});
    await page.bringToFront().catch(() => {});
    await showChromeWindowByProfile(this.sessions.getProfilePath('spreadshirt')).catch(() => {});
    return result;
  } finally {
    this.sessions.__zeroPodSpreadshirtManualOpen = false;
  }
};

module.exports = { hideChromeWindowByProfile, showChromeWindowByProfile };