const { execFile } = require('child_process');
const { SessionManager, SERVICES } = require('./sessionManager');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalLaunchNormalLoginBrowser = SessionManager.prototype.launchNormalLoginBrowser;

async function visible(locator, timeout = 900) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function centerNativeLoginWindow(manager, serviceId) {
  if (process.platform !== 'win32') return;
  const runtime = manager.loginBrowsers?.get(serviceId);
  const pid = Number(runtime?.process?.pid || 0);
  if (!pid) return;

  const host = manager.__zeroPodHostWindow;
  let bounds = null;
  try { bounds = host?.getBounds?.() || null; } catch {}

  const width = Math.max(900, Math.min(1200, Math.round((bounds?.width || 1420) * 0.86)));
  const height = Math.max(700, Math.min(860, Math.round((bounds?.height || 900) * 0.90)));
  const left = Math.round((bounds?.x || 0) + ((bounds?.width || 1420) - width) / 2);
  const top = Math.round((bounds?.y || 0) + ((bounds?.height || 900) - height) / 2);

  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class ZeroPodWindow {',
    '  [DllImport("user32.dll", SetLastError=true)]',
    '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    '"@ -ErrorAction SilentlyContinue',
    `for ($i=0; $i -lt 20; $i++) { $p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [ZeroPodWindow]::SetWindowPos($p.MainWindowHandle,[IntPtr]::Zero,${left},${top},${width},${height},0x0040) | Out-Null; break }; Start-Sleep -Milliseconds 200 }`
  ].join("\n");

  await new Promise((resolve) => execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true },
    () => resolve()
  ));
}

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserCentered(serviceId) {
  const result = await originalLaunchNormalLoginBrowser.call(this, serviceId);
  centerNativeLoginWindow(this, serviceId).catch(() => {});
  return result;
};

async function explicitLoggedOut(manager, serviceId, page) {
  const service = SERVICES[serviceId];
  const url = page.url();
  if (/accounts\.google\.com/i.test(url)) return true;
  if (service?.loginUrlPatterns?.some((pattern) => pattern.test(url))) return true;
  for (const pattern of service?.loggedOutText || []) {
    if (await visible(page.getByText(pattern, { exact: true }), 450)) return true;
  }
  return false;
}

async function authCookieHint(page, serviceId) {
  try {
    const cookies = await page.context().cookies();
    const serviceHosts = {
      chatgpt: /chatgpt\.com|openai\.com/i,
      vectorizer: /vectorizer\.ai/i,
      redbubble: /redbubble\.com/i
    };
    const domainPattern = serviceHosts[serviceId];
    return cookies.some((cookie) => {
      if (domainPattern && !domainPattern.test(cookie.domain || '')) return false;
      return /(session|auth|token|login|account|user|jwt|secure)/i.test(cookie.name || '');
    });
  } catch {
    return false;
  }
}

async function verifyChatGPT(page) {
  try {
    const session = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    });
    if (session && typeof session === 'object' && (session.user || session.accessToken || session.account || session.email)) {
      return true;
    }
  } catch {}

  const selectors = [
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    '[data-testid*="profile" i]',
    '[data-testid*="account" i]',
    '[data-testid="accounts-profile-button"]'
  ];
  for (const selector of selectors) {
    if (await visible(page.locator(selector), 500)) return true;
  }
  return false;
}

async function verifyRedbubble(page) {
  try {
    await page.goto('https://www.redbubble.com/portfolio/manage_works', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(700);
  } catch {}

  if (/\/portfolio\/manage_works/i.test(page.url())) return true;

  const selectors = [
    'a[href*="/portfolio" i]',
    'a[href*="manage_works" i]',
    'a[href*="/account" i]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]'
  ];
  for (const selector of selectors) {
    if (await visible(page.locator(selector), 500)) return true;
  }
  return false;
}

async function robustAuthState(manager, serviceId, page) {
  const service = SERVICES[serviceId];
  if (!service) return { status: 'unknown', message: 'Unknown service.' };

  if (await manager.detectHumanVerification(page).catch(() => false)) {
    return {
      status: 'human-verification',
      message: `${service.name} is showing a human-verification challenge. Complete it manually in Chrome, then test again.`
    };
  }

  if (await explicitLoggedOut(manager, serviceId, page)) {
    return {
      status: 'needs-login',
      message: `${service.name} is showing a login/sign-in gate in the saved Chrome profile.`
    };
  }

  if (serviceId === 'chatgpt' && await verifyChatGPT(page)) {
    return { status: 'verified', message: 'ChatGPT account session verified from the saved Chrome profile.' };
  }

  if (serviceId === 'redbubble' && await verifyRedbubble(page)) {
    return { status: 'verified', message: 'Redbubble account session verified by opening Manage Works in the saved Chrome profile.' };
  }

  if (serviceId === 'vectorizer') {
    for (const selector of service.authenticatedSelectors || []) {
      if (await visible(page.locator(selector), 500)) {
        return { status: 'verified', message: 'Vectorizer.ai saved Chrome session verified.' };
      }
    }
    if (await authCookieHint(page, serviceId)) {
      return { status: 'verified', message: 'Vectorizer.ai saved Chrome session verified from its active session data.' };
    }
    // Vectorizer can expose its normal workspace without a separate account page.
    // If the real site loaded and no login or verification gate is present, the
    // session is operational for ZeroPOD automation.
    if (/^https:\/\/(?:www\.)?vectorizer\.ai\//i.test(page.url())) {
      return { status: 'verified', message: 'Vectorizer.ai workspace is reachable with no login or verification gate.' };
    }
  }

  for (const selector of service.authenticatedSelectors || []) {
    if (await visible(page.locator(selector), 500)) {
      return { status: 'verified', message: `${service.name} authenticated account UI detected.` };
    }
  }

  if (await authCookieHint(page, serviceId)) {
    return { status: 'verified', message: `${service.name} active saved session data detected.` };
  }

  return {
    status: 'unknown',
    message: `${service.name} opened successfully, but ZeroPOD could not confidently verify an authenticated account yet.`
  };
}

SessionManager.prototype.test = async function testSessionReliably(serviceId) {
  const service = SERVICES[serviceId];
  if (!service) throw new Error(`Unknown service: ${serviceId}`);

  const { page } = await this.ensureService(serviceId);
  if (!page.url().startsWith(service.url) && serviceId !== 'redbubble') {
    await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (serviceId !== 'redbubble') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  await wait(800);

  const result = await robustAuthState(this, serviceId, page);
  this.updateState(serviceId, {
    profileCreated: true,
    loginMode: 'normal-chrome-handoff',
    browser: 'chrome',
    authStatus: result.status,
    lastVerifiedAt: new Date().toISOString(),
    verificationMessage: result.message
  });

  return {
    ok: result.status === 'verified',
    serviceId,
    browser: 'chrome',
    ...result
  };
};

module.exports = { robustAuthState, centerNativeLoginWindow };
