const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');
const { SessionManager, SERVICES } = require('./sessionManager');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalGetProfilePath = SessionManager.prototype.getProfilePath;
const originalLaunchNormalLoginBrowser = SessionManager.prototype.launchNormalLoginBrowser;
const originalEnsureService = SessionManager.prototype.ensureService;
const originalDetectAuthState = SessionManager.prototype.detectAuthState;
const originalTest = SessionManager.prototype.test;
const originalLogin = SessionManager.prototype.login;

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

SessionManager.prototype.getProfilePath = function getProfilePathBrowserAware(serviceId) {
  if (serviceId === 'chatgpt') return path.join(app.getPath('userData'), 'profiles', 'chatgpt-chrome');
  return originalGetProfilePath.call(this, serviceId);
};

SessionManager.prototype.killProfileEdgeProcesses = async function killProfileBrowserProcesses(serviceId) {
  if (process.platform !== 'win32') return;
  const profile = this.getProfilePath(serviceId).replace(/'/g, "''");
  const script = `$p='${profile}'; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains($p) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await new Promise((resolve) => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', script], { windowsHide: true }, () => resolve()));
  await wait(700);
};

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserChromeFirst(serviceId) {
  if (serviceId !== 'chatgpt') return originalLaunchNormalLoginBrowser.call(this, serviceId);
  const chromePath = findChromeExecutable();
  if (!chromePath) return originalLaunchNormalLoginBrowser.call(this, serviceId);
  const service = SERVICES[serviceId];
  await this.closeAutomationContext(serviceId);
  await this.closeLoginBrowser(serviceId);
  const profilePath = this.getProfilePath(serviceId);
  fs.mkdirSync(profilePath, { recursive: true });
  const child = spawn(chromePath, [`--user-data-dir=${profilePath}`, '--no-first-run', '--no-default-browser-check', service.url], { detached: false, stdio: 'ignore', windowsHide: false });
  this.loginBrowsers.set(serviceId, { process: child, browser: 'chrome' });
  child.once('exit', () => {
    const current = this.loginBrowsers.get(serviceId);
    if (current?.process === child) this.loginBrowsers.delete(serviceId);
  });
  this.markProfile(serviceId, { loginMode: 'google-chrome-handoff', browser: 'chrome' });
  return { ok: true, browser: 'chrome' };
};

SessionManager.prototype.ensureService = async function ensureServiceChromeForChatGPT(serviceId) {
  if (serviceId !== 'chatgpt') return originalEnsureService.call(this, serviceId);
  const chromePath = findChromeExecutable();
  if (!chromePath) return originalEnsureService.call(this, serviceId);
  const service = SERVICES[serviceId];
  let context = this.contexts.get(serviceId);
  if (!context) {
    await this.closeLoginBrowser(serviceId);
    await this.killProfileEdgeProcesses(serviceId);
    fs.mkdirSync(this.getProfilePath(serviceId), { recursive: true });
    try {
      context = await chromium.launchPersistentContext(this.getProfilePath(serviceId), {
        executablePath: chromePath,
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1280, height: 860 },
        ignoreDefaultArgs: ['--no-sandbox'],
        args: ['--no-first-run', '--no-default-browser-check']
      });
    } catch (error) {
      if (/profile is already in use|opening in existing browser session/i.test(error.message || '')) {
        throw new Error('ChatGPT Chrome profile is still open. Close the dedicated ZeroPOD Chrome window and retry.');
      }
      throw error;
    }
    this.contexts.set(serviceId, context);
    this.markProfile(serviceId, { loginMode: 'google-chrome-handoff', browser: 'chrome' });
    context.on('close', () => this.contexts.delete(serviceId));
  }
  let page = context.pages().find((candidate) => candidate.url().startsWith(service.url));
  if (!page) page = context.pages()[0] || await context.newPage();
  if (!page.url().startsWith(service.url)) await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return { context, page, service, browser: 'chrome' };
};

SessionManager.prototype.detectAuthState = async function detectAuthStateBrowserAware(serviceId, page) {
  const result = await originalDetectAuthState.call(this, serviceId, page);
  if (serviceId === 'chatgpt' && findChromeExecutable()) {
    result.message = String(result.message || '').replace(/Edge/g, 'Chrome');
  }
  return result;
};

SessionManager.prototype.test = async function testBrowserAware(serviceId) {
  const result = await originalTest.call(this, serviceId);
  if (serviceId === 'chatgpt' && findChromeExecutable()) {
    this.updateState(serviceId, { loginMode: 'google-chrome-handoff', browser: 'chrome' });
  }
  return result;
};

SessionManager.prototype.login = async function loginBrowserAware(serviceId) {
  if (serviceId !== 'chatgpt' || !findChromeExecutable()) return originalLogin.call(this, serviceId);
  await this.launchNormalLoginBrowser(serviceId);
  this.updateState(serviceId, {
    profileCreated: true,
    loginMode: 'google-chrome-handoff',
    browser: 'chrome',
    authStatus: 'unknown',
    verificationMessage: 'Google Chrome opened. Finish ChatGPT login and any human-verification challenge manually, close that dedicated Chrome window if it stays open, then click Test Session.'
  });
  return { ok: true, mode: 'google-chrome-handoff', browser: 'chrome' };
};

module.exports = { findChromeExecutable };
