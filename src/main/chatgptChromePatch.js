const fs = require('fs');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');
const { SessionManager, SERVICES } = require('./sessionManager');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const originalGetProfilePath = SessionManager.prototype.getProfilePath;
const originalGetStatuses = SessionManager.prototype.getStatuses;
const originalKillProfileEdgeProcesses = SessionManager.prototype.killProfileEdgeProcesses;
const originalCloseAutomationContext = SessionManager.prototype.closeAutomationContext;
const originalCloseLoginBrowser = SessionManager.prototype.closeLoginBrowser;
const originalLaunchNormalLoginBrowser = SessionManager.prototype.launchNormalLoginBrowser;
const originalEnsureService = SessionManager.prototype.ensureService;
const originalDetectAuthState = SessionManager.prototype.detectAuthState;
const originalTest = SessionManager.prototype.test;
const originalLogin = SessionManager.prototype.login;

const automationRuntimes = new WeakMap();

function runtimeMap(manager) {
  let map = automationRuntimes.get(manager);
  if (!map) {
    map = new Map();
    automationRuntimes.set(manager, map);
  }
  return map;
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close(() => {
        if (!port) reject(new Error('Could not allocate a local Chrome debugging port.'));
        else resolve(port);
      });
    });
  });
}

async function waitForCdp(port, timeoutMs = 20000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return true;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(`Chrome did not expose its local automation endpoint.${lastError?.message ? ` ${lastError.message}` : ''}`);
}

async function gracefullyCloseProcess(child) {
  if (!child?.pid) return;
  const pid = Number(child.pid);

  if (process.platform === 'win32') {
    const script = [
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      `if ($p) { $null = $p.CloseMainWindow() }`,
      `Start-Sleep -Milliseconds 1400`,
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      `if ($p) { Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue }`
    ].join('; ');
    await new Promise((resolve) => execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
      () => resolve()
    ));
    return;
  }

  if (!child.killed) child.kill('SIGTERM');
  await wait(500);
}

SessionManager.prototype.getProfilePath = function getProfilePathBrowserAware(serviceId) {
  // Use a fresh profile that has never been launched by Playwright. The previous
  // chatgpt-chrome profile may contain state from launchPersistentContext tests,
  // which can make Google classify the browser as automated during OAuth.
  if (serviceId === 'chatgpt' && findChromeExecutable()) {
    return path.join(app.getPath('userData'), 'profiles', 'chatgpt-chrome-native');
  }
  return originalGetProfilePath.call(this, serviceId);
};

SessionManager.prototype.getStatuses = function getStatusesBrowserAware() {
  const statuses = originalGetStatuses.call(this);
  if (statuses.chatgpt && findChromeExecutable()) {
    statuses.chatgpt.browser = 'chrome';
    statuses.chatgpt.loginMode = 'normal-chrome-handoff';
  }
  return statuses;
};

SessionManager.prototype.killProfileEdgeProcesses = async function killProfileBrowserProcesses(serviceId) {
  if (serviceId !== 'chatgpt' || !findChromeExecutable()) {
    return originalKillProfileEdgeProcesses.call(this, serviceId);
  }

  if (process.platform !== 'win32') return;
  const profile = this.getProfilePath(serviceId).replace(/'/g, "''");
  const script = `$p='${profile}'; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($p) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await new Promise((resolve) => execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true },
    () => resolve()
  ));
  await wait(500);
};

SessionManager.prototype.closeLoginBrowser = async function closeLoginBrowserBrowserAware(serviceId) {
  if (serviceId !== 'chatgpt' || !findChromeExecutable()) {
    return originalCloseLoginBrowser.call(this, serviceId);
  }

  const runtime = this.loginBrowsers.get(serviceId);
  if (runtime?.process) await gracefullyCloseProcess(runtime.process);
  this.loginBrowsers.delete(serviceId);
  await this.killProfileEdgeProcesses(serviceId);
  await wait(500);
};

SessionManager.prototype.closeAutomationContext = async function closeAutomationContextBrowserAware(serviceId) {
  if (serviceId !== 'chatgpt' || !findChromeExecutable()) {
    return originalCloseAutomationContext.call(this, serviceId);
  }

  const map = runtimeMap(this);
  const runtime = map.get(serviceId);
  if (runtime) {
    if (runtime.browser) await runtime.browser.close().catch(() => {});
    if (runtime.process) await gracefullyCloseProcess(runtime.process).catch(() => {});
    map.delete(serviceId);
  }
  this.contexts.delete(serviceId);
  await this.killProfileEdgeProcesses(serviceId).catch(() => {});
};

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserChromeNative(serviceId) {
  if (serviceId !== 'chatgpt' || !findChromeExecutable()) {
    return originalLaunchNormalLoginBrowser.call(this, serviceId);
  }

  const service = SERVICES[serviceId];
  await this.closeAutomationContext(serviceId);
  await this.closeLoginBrowser(serviceId);

  const chromePath = findChromeExecutable();
  const profilePath = this.getProfilePath(serviceId);
  fs.mkdirSync(profilePath, { recursive: true });

  // This is deliberately a plain, installed Chrome process. Do not add remote
  // debugging, --enable-automation, Playwright launch arguments, custom UA, or
  // webdriver attachment while Google/email/password/2FA is being completed.
  const child = spawn(
    chromePath,
    [`--user-data-dir=${profilePath}`, service.url],
    { detached: false, stdio: 'ignore', windowsHide: false }
  );

  this.loginBrowsers.set(serviceId, { process: child, browser: 'chrome', nativeLogin: true });
  child.once('exit', () => {
    const current = this.loginBrowsers.get(serviceId);
    if (current?.process === child) this.loginBrowsers.delete(serviceId);
  });

  this.markProfile(serviceId, {
    loginMode: 'normal-chrome-handoff',
    browser: 'chrome'
  });

  return { ok: true, browser: 'chrome', mode: 'normal-chrome-handoff' };
};

async function launchAndAttachChrome(manager, serviceId) {
  const service = SERVICES[serviceId];
  const chromePath = findChromeExecutable();
  const profilePath = manager.getProfilePath(serviceId);

  // Test Session / automation begins only after manual login. Close the normal
  // login Chrome gracefully first so its cookies and profile state are flushed.
  await manager.closeLoginBrowser(serviceId);
  await manager.killProfileEdgeProcesses(serviceId);
  await wait(700);

  fs.mkdirSync(profilePath, { recursive: true });
  fs.rmSync(path.join(profilePath, 'DevToolsActivePort'), { force: true });

  const port = await getFreePort();
  const child = spawn(
    chromePath,
    [
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      service.url
    ],
    { detached: false, stdio: 'ignore', windowsHide: false }
  );

  const runtime = { process: child, port, browser: null, context: null };
  runtimeMap(manager).set(serviceId, runtime);

  child.once('exit', () => {
    const map = runtimeMap(manager);
    const current = map.get(serviceId);
    if (current?.process === child) map.delete(serviceId);
    manager.contexts.delete(serviceId);
  });

  try {
    await waitForCdp(port);
    runtime.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    runtime.context = runtime.browser.contexts()[0] || null;
    if (!runtime.context) throw new Error('Chrome opened, but ZeroPOD could not attach to its signed-in profile.');

    manager.contexts.set(serviceId, runtime.context);
    runtime.browser.on('disconnected', () => {
      manager.contexts.delete(serviceId);
      const map = runtimeMap(manager);
      const current = map.get(serviceId);
      if (current === runtime) map.delete(serviceId);
    });

    manager.markProfile(serviceId, {
      loginMode: 'normal-chrome-handoff',
      browser: 'chrome'
    });
    return runtime;
  } catch (error) {
    await gracefullyCloseProcess(child).catch(() => {});
    runtimeMap(manager).delete(serviceId);
    manager.contexts.delete(serviceId);
    throw error;
  }
}

SessionManager.prototype.ensureService = async function ensureServiceChromeNative(serviceId) {
  if (serviceId !== 'chatgpt' || !findChromeExecutable()) {
    return originalEnsureService.call(this, serviceId);
  }

  const service = SERVICES[serviceId];
  const map = runtimeMap(this);
  let runtime = map.get(serviceId);

  if (!runtime?.browser?.isConnected?.() || !runtime.context) {
    runtime = await launchAndAttachChrome(this, serviceId);
  }

  let page = runtime.context.pages().find((candidate) => candidate.url().startsWith(service.url));
  if (!page) page = runtime.context.pages()[0] || await runtime.context.newPage();
  if (!page.url().startsWith(service.url)) {
    await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }

  return { context: runtime.context, page, service, browser: 'chrome' };
};

SessionManager.prototype.detectAuthState = async function detectAuthStateBrowserAware(serviceId, page) {
  if (serviceId === 'chatgpt' && findChromeExecutable()) {
    const url = page.url();
    if (/accounts\.google\.com/i.test(url)) {
      return {
        status: 'needs-login',
        message: 'Google sign-in is required. Use Open Login Browser so authentication happens in normal Chrome without automation attached, then click Test Session.'
      };
    }
  }

  const result = await originalDetectAuthState.call(this, serviceId, page);
  if (serviceId === 'chatgpt' && findChromeExecutable()) {
    result.message = String(result.message || '').replace(/Microsoft Edge/g, 'Google Chrome').replace(/Edge/g, 'Chrome');
  }
  return result;
};

SessionManager.prototype.test = async function testBrowserAware(serviceId) {
  const result = await originalTest.call(this, serviceId);
  if (serviceId === 'chatgpt' && findChromeExecutable()) {
    this.updateState(serviceId, {
      loginMode: 'normal-chrome-handoff',
      browser: 'chrome',
      verificationMessage: String(result.message || '').replace(/Microsoft Edge/g, 'Google Chrome').replace(/Edge/g, 'Chrome')
    });
  }
  return result;
};

SessionManager.prototype.login = async function loginBrowserAware(serviceId) {
  if (serviceId !== 'chatgpt' || !findChromeExecutable()) {
    return originalLogin.call(this, serviceId);
  }

  await this.launchNormalLoginBrowser(serviceId);
  this.updateState(serviceId, {
    profileCreated: true,
    loginMode: 'normal-chrome-handoff',
    browser: 'chrome',
    authStatus: 'unknown',
    verificationMessage: 'Normal Google Chrome opened with ZeroPOD’s clean ChatGPT profile. Finish Google/email/password/2FA manually. When login is complete, return to ZeroPOD and click Test Session; ZeroPOD will then restart that signed-in profile for automation.'
  });

  return {
    ok: true,
    mode: 'normal-chrome-handoff',
    browser: 'chrome',
    message: 'Sign in in the normal Chrome window, then click Test Session.'
  };
};

module.exports = { findChromeExecutable };
