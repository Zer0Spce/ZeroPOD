const fs = require('fs');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');
const { SessionManager, SERVICES } = require('./sessionManager');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const originalGetStatuses = SessionManager.prototype.getStatuses;
const originalDetectAuthState = SessionManager.prototype.detectAuthState;
const originalTest = SessionManager.prototype.test;

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

function requireChromeExecutable() {
  const chromePath = findChromeExecutable();
  if (!chromePath) throw new Error('Google Chrome was not found. Install Chrome or set CHROME_PATH to chrome.exe. ZeroPOD is configured to use Chrome for ChatGPT, Vectorizer.ai, and Redbubble.');
  return chromePath;
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
    await wait(200);
  }
  throw new Error(`Chrome did not expose its local automation endpoint.${lastError?.message ? ` ${lastError.message}` : ''}`);
}

async function gracefullyCloseProcess(child) {
  if (!child?.pid) return;
  const pid = Number(child.pid);

  if (process.platform === 'win32') {
    const script = [
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      'if ($p) { $null = $p.CloseMainWindow() }',
      'Start-Sleep -Milliseconds 1200',
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

SessionManager.prototype.getProfilePath = function getProfilePathChrome(serviceId) {
  if (!SERVICES[serviceId]) throw new Error(`Unknown service: ${serviceId}`);
  return path.join(app.getPath('userData'), 'profiles', `${serviceId}-chrome-native`);
};

SessionManager.prototype.getStatuses = function getStatusesChrome() {
  const statuses = originalGetStatuses.call(this);
  for (const service of Object.values(statuses)) {
    service.browser = 'chrome';
    service.loginMode = 'normal-chrome-handoff';
  }
  return statuses;
};

// Keep the legacy method name because SessionManager.logout() calls it, but make it
// terminate only Chrome processes that belong to the requested dedicated profile.
SessionManager.prototype.killProfileEdgeProcesses = async function killProfileChromeProcesses(serviceId) {
  if (process.platform !== 'win32') return;
  const profile = this.getProfilePath(serviceId).replace(/'/g, "''");
  const script = `$p='${profile}'; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($p) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await new Promise((resolve) => execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true },
    () => resolve()
  ));
  await wait(350);
};

SessionManager.prototype.closeLoginBrowser = async function closeLoginBrowserChrome(serviceId) {
  const runtime = this.loginBrowsers.get(serviceId);
  if (runtime?.process) await gracefullyCloseProcess(runtime.process).catch(() => {});
  this.loginBrowsers.delete(serviceId);
  await this.killProfileEdgeProcesses(serviceId).catch(() => {});
  await wait(300);
};

SessionManager.prototype.closeAutomationContext = async function closeAutomationContextChrome(serviceId) {
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

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserChrome(serviceId) {
  const service = SERVICES[serviceId];
  if (!service) throw new Error(`Unknown service: ${serviceId}`);

  await this.closeAutomationContext(serviceId);
  await this.closeLoginBrowser(serviceId);

  const chromePath = requireChromeExecutable();
  const profilePath = this.getProfilePath(serviceId);
  fs.mkdirSync(profilePath, { recursive: true });

  // Authentication always happens in an ordinary installed-Chrome process. There
  // is no Playwright attachment or remote-debugging flag during Google/password/
  // CAPTCHA/2FA login. Automation attaches only after the user finishes login.
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

  this.markProfile(serviceId, { loginMode: 'normal-chrome-handoff', browser: 'chrome' });
  return { ok: true, browser: 'chrome', mode: 'normal-chrome-handoff' };
};

async function launchAndAttachChrome(manager, serviceId) {
  const service = SERVICES[serviceId];
  if (!service) throw new Error(`Unknown service: ${serviceId}`);
  const chromePath = requireChromeExecutable();
  const profilePath = manager.getProfilePath(serviceId);

  await manager.closeLoginBrowser(serviceId);
  await manager.killProfileEdgeProcesses(serviceId);
  await wait(450);

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
    if (!runtime.context) throw new Error(`${service.name} opened in Chrome, but ZeroPOD could not attach to its saved profile.`);

    manager.contexts.set(serviceId, runtime.context);
    runtime.browser.on('disconnected', () => {
      manager.contexts.delete(serviceId);
      const map = runtimeMap(manager);
      const current = map.get(serviceId);
      if (current === runtime) map.delete(serviceId);
    });

    manager.markProfile(serviceId, { loginMode: 'normal-chrome-handoff', browser: 'chrome' });
    return runtime;
  } catch (error) {
    await gracefullyCloseProcess(child).catch(() => {});
    runtimeMap(manager).delete(serviceId);
    manager.contexts.delete(serviceId);
    throw error;
  }
}

SessionManager.prototype.ensureService = async function ensureServiceChrome(serviceId) {
  const service = SERVICES[serviceId];
  if (!service) throw new Error(`Unknown service: ${serviceId}`);

  const map = runtimeMap(this);
  let runtime = map.get(serviceId);
  if (!runtime?.browser?.isConnected?.() || !runtime.context) {
    runtime = await launchAndAttachChrome(this, serviceId);
  }

  let page = runtime.context.pages().find((candidate) => candidate.url().startsWith(service.url));
  if (!page) page = runtime.context.pages()[0] || await runtime.context.newPage();
  if (!page.url().startsWith(service.url)) {
    await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  return { context: runtime.context, page, service, browser: 'chrome' };
};

SessionManager.prototype.detectAuthState = async function detectAuthStateChrome(serviceId, page) {
  const url = page.url();
  if (/accounts\.google\.com/i.test(url)) {
    return {
      status: 'needs-login',
      message: 'Google sign-in is required. Use Open Login Browser so authentication happens in normal Chrome without automation attached, then click Test Session.'
    };
  }

  const result = await originalDetectAuthState.call(this, serviceId, page);
  result.message = String(result.message || '')
    .replace(/Microsoft Edge/g, 'Google Chrome')
    .replace(/Edge/g, 'Chrome');
  return result;
};

SessionManager.prototype.test = async function testChrome(serviceId) {
  const result = await originalTest.call(this, serviceId);
  this.updateState(serviceId, {
    loginMode: 'normal-chrome-handoff',
    browser: 'chrome',
    verificationMessage: String(result.message || '')
      .replace(/Microsoft Edge/g, 'Google Chrome')
      .replace(/Edge/g, 'Chrome')
  });
  return { ...result, browser: 'chrome' };
};

SessionManager.prototype.login = async function loginChrome(serviceId) {
  const service = SERVICES[serviceId];
  if (!service) throw new Error(`Unknown service: ${serviceId}`);

  await this.launchNormalLoginBrowser(serviceId);
  this.updateState(serviceId, {
    profileCreated: true,
    loginMode: 'normal-chrome-handoff',
    browser: 'chrome',
    authStatus: 'unknown',
    verificationMessage: `Normal Google Chrome opened with ZeroPOD’s dedicated ${service.name} profile. Finish login and any Google/password/2FA/CAPTCHA challenge manually. When login is complete, return to ZeroPOD and click Test Session.`
  });

  return {
    ok: true,
    mode: 'normal-chrome-handoff',
    browser: 'chrome',
    message: `Sign in to ${service.name} in the normal Chrome window, then click Test Session.`
  };
};

module.exports = { findChromeExecutable };
