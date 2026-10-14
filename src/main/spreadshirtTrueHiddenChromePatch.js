const { execFile, spawn } = require('child_process');
const { SessionManager } = require('./sessionManager');
const { feature } = require('./spreadshirtAlphaIpc');
const { keepAutomationWindowOffscreen, showAutomationWindow } = require('./chromeDockPatch');

function psEscape(value) {
  return String(value || '').replace(/'/g, "''");
}

function win32TypeDefinition(className = 'ZeroPodHideWin32') {
  return [
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    `public static class ${className} {`,
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);',
    '}',
    "'@"
  ];
}

function runWindowCommand(profilePath, mode = 'hide', watchMs = 0) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'non-windows' });
  const profile = psEscape(profilePath);
  if (!profile) return Promise.resolve({ ok: false, reason: 'missing-profile' });

  const show = mode === 'show';
  const duration = Math.max(0, Number(watchMs) || 0);
  const script = [
    ...win32TypeDefinition('ZeroPodHideWin32'),
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
    show ? '  break' : '  if ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 140 }',
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

// A cancellable native hide lease is used during every automatic Spreadshirt
// prepare/publish operation. It continuously applies SW_HIDE to the real browser
// window, so page.bringToFront() can switch Playwright tabs without ever exposing
// an unclickable Chrome/Edge window behind ZeroPOD.
function startChromeHideLease(profilePath) {
  if (process.platform !== 'win32') return { stop() {} };
  const profile = psEscape(profilePath);
  if (!profile) return { stop() {} };

  const script = [
    ...win32TypeDefinition('ZeroPodHideLeaseWin32'),
    `$profile='${profile}'`,
    '$windowPid=$null',
    'while ($true) {',
    '  if ($null -eq $windowPid) {',
    '    $rows=@(Get-CimInstance Win32_Process | Where-Object {',
    "      ($_.Name -ieq 'chrome.exe' -or $_.Name -ieq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains($profile)",
    '    })',
    '    foreach ($row in $rows) {',
    '      $candidate=Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue',
    '      if ($candidate -and $candidate.MainWindowHandle -ne 0) { $windowPid=$row.ProcessId; break }',
    '    }',
    '  }',
    '  if ($null -ne $windowPid) {',
    '    $proc=Get-Process -Id $windowPid -ErrorAction SilentlyContinue',
    '    if (-not $proc) { $windowPid=$null }',
    '    elseif ($proc.MainWindowHandle -ne 0) { [ZeroPodHideLeaseWin32]::ShowWindowAsync($proc.MainWindowHandle,0) | Out-Null }',
    '    else { $windowPid=$null }',
    '  }',
    '  Start-Sleep -Milliseconds 180',
    '}'
  ].join('\n');

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, stdio: 'ignore' }
  );
  child.unref?.();

  return {
    stop() {
      if (!child || child.killed) return;
      try { child.kill(); } catch {}
      if (child.pid) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    }
  };
}

const previousEnsureService = SessionManager.prototype.ensureService;
SessionManager.prototype.ensureService = async function ensureServiceWithNativeSpreadshirtHide(serviceId) {
  const manualOpen = serviceId === 'spreadshirt' && Boolean(this.__zeroPodSpreadshirtManualOpen);
  const profilePath = serviceId === 'spreadshirt' ? this.getProfilePath(serviceId) : null;

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

module.exports = { hideChromeWindowByProfile, showChromeWindowByProfile, startChromeHideLease };
