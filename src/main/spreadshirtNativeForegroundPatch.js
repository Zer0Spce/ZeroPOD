const { execFile } = require('child_process');
const { SessionManager } = require('./sessionManager');
const { showAutomationWindow, keepAutomationWindowOffscreen } = require('./chromeDockPatch');

function focusChromeWindowByProfile(profilePath) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'non-windows' });
  const profile = String(profilePath || '').replace(/'/g, "''");
  if (!profile) return Promise.resolve({ ok: false, reason: 'missing-profile' });

  const script = [
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class ZeroPodWin32 {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    "'@",
    `$profile='${profile}'`,
    `$pids=@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } | Select-Object -ExpandProperty ProcessId)`,
    '$proc=$null',
    'foreach ($pid in $pids) {',
    '  $candidate=Get-Process -Id $pid -ErrorAction SilentlyContinue',
    '  if ($candidate -and $candidate.MainWindowHandle -ne 0) { $proc=$candidate; break }',
    '}',
    'if (-not $proc) { Write-Output "NO_WINDOW"; exit 0 }',
    '$h=$proc.MainWindowHandle',
    '[ZeroPodWin32]::ShowWindowAsync($h,9) | Out-Null',
    '[ZeroPodWin32]::BringWindowToTop($h) | Out-Null',
    '[ZeroPodWin32]::SetWindowPos($h,[IntPtr](-1),0,0,0,0,0x0003) | Out-Null',
    'Start-Sleep -Milliseconds 50',
    '[ZeroPodWin32]::SetWindowPos($h,[IntPtr](-2),0,0,0,0,0x0003) | Out-Null',
    'try { (New-Object -ComObject WScript.Shell).AppActivate($proc.Id) | Out-Null } catch {}',
    '[ZeroPodWin32]::SetForegroundWindow($h) | Out-Null',
    'Write-Output "FOCUSED"'
  ].join("\n");

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        const output = String(stdout || '').trim();
        if (error) return resolve({ ok: false, reason: 'powershell-focus-failed', message: error.message || String(error) });
        resolve({ ok: /FOCUSED/i.test(output), reason: /NO_WINDOW/i.test(output) ? 'window-not-found' : null, output });
      }
    );
  });
}

SessionManager.prototype.focusAutomationWindow = async function focusAutomationWindow(serviceId, suppliedPage = null) {
  let page = suppliedPage;
  if (!page || page.isClosed?.()) {
    const result = await this.ensureService(serviceId);
    page = result.page;
  }

  // Spreadshirt now behaves like the rest of ZeroPOD automation: keep Chrome
  // fully rendered off-screen and never raise its native window during prepare,
  // publish, verification, success, or error handling.
  if (serviceId === 'spreadshirt') {
    this.setAutomationWindowVisible?.(serviceId, false);
    await keepAutomationWindowOffscreen(page).catch(() => {});
    return { ok: true, hidden: true, nativeFocused: false };
  }

  this.setAutomationWindowVisible?.(serviceId, true);
  await showAutomationWindow(page).catch(() => {});
  await page.bringToFront().catch(() => {});
  const native = await focusChromeWindowByProfile(this.getProfilePath(serviceId)).catch((error) => ({ ok: false, reason: error?.message || String(error) }));
  return { ok: true, nativeFocused: Boolean(native?.ok), native };
};

module.exports = { focusChromeWindowByProfile };
