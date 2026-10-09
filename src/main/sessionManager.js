const { app, safeStorage } = require('electron');
const { chromium } = require('playwright');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVICES = {
  chatgpt: {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    loginUrlPatterns: [/\/auth/i, /\/login/i, /\/signin/i, /\/sign-in/i],
    loggedOutText: [/^log in$/i, /^sign up$/i, /^sign in$/i],
    authenticatedSelectors: [
      'button[aria-label*="profile" i]',
      'button[aria-label*="account" i]',
      '[data-testid*="profile" i]',
      '[data-testid*="account" i]'
    ]
  },
  vectorizer: {
    name: 'Vectorizer.ai',
    url: 'https://vectorizer.ai/',
    loginUrlPatterns: [/\/login/i, /\/signin/i, /\/sign-in/i],
    loggedOutText: [/^log in$/i, /^sign in$/i, /^create account$/i],
    authenticatedSelectors: [
      'a[href*="account" i]',
      'button[aria-label*="account" i]',
      '[class*="account" i]'
    ]
  },
  redbubble: {
    name: 'Redbubble',
    url: 'https://www.redbubble.com/',
    loginUrlPatterns: [/\/auth\/login/i, /\/login/i, /\/signin/i, /\/sign-in/i],
    loggedOutText: [/^log in$/i, /^sign in$/i, /^sign up$/i],
    authenticatedSelectors: [
      'a[href*="portfolio" i]',
      'a[href*="account" i]',
      'button[aria-label*="account" i]',
      'button[aria-label*="profile" i]'
    ]
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class SessionManager {
  constructor() {
    this.contexts = new Map();
    this.loginBrowsers = new Map();
  }

  getRoot() {
    return path.join(app.getPath('userData'), 'profiles');
  }

  getProfilePath(serviceId) {
    return path.join(this.getRoot(), serviceId);
  }

  getStatePath() {
    return path.join(app.getPath('userData'), 'connections.bin');
  }

  readState() {
    try {
      const file = this.getStatePath();
      if (!fs.existsSync(file)) return {};
      const encrypted = fs.readFileSync(file);
      if (!safeStorage.isEncryptionAvailable()) return {};
      return JSON.parse(safeStorage.decryptString(encrypted));
    } catch {
      return {};
    }
  }

  writeState(state) {
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(state));
    fs.writeFileSync(this.getStatePath(), encrypted);
  }

  updateState(serviceId, patch) {
    const state = this.readState();
    state[serviceId] = { ...(state[serviceId] || {}), ...patch };
    this.writeState(state);
    return state[serviceId];
  }

  markProfile(serviceId, extra = {}) {
    this.updateState(serviceId, {
      profileCreated: true,
      authStatus: this.readState()[serviceId]?.authStatus || 'unknown',
      lastConnectedAt: new Date().toISOString(),
      ...extra
    });
  }

  getStatuses() {
    const state = this.readState();
    return Object.fromEntries(
      Object.entries(SERVICES).map(([id, service]) => {
        const saved = Boolean(state[id]?.profileCreated);
        const authStatus = saved ? (state[id]?.authStatus || 'unknown') : 'not-configured';
        return [id, {
          id,
          name: service.name,
          saved,
          connected: authStatus === 'verified',
          authStatus,
          loginMode: state[id]?.loginMode || 'normal-edge-handoff',
          lastConnectedAt: state[id]?.lastConnectedAt || null,
          lastVerifiedAt: state[id]?.lastVerifiedAt || null,
          verificationMessage: state[id]?.verificationMessage || null
        }];
      })
    );
  }

  findEdgeExecutable() {
    const candidates = [
      process.env.EDGE_PATH,
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ].filter(Boolean);
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error('Microsoft Edge was not found. Install Edge or set EDGE_PATH to msedge.exe.');
    return found;
  }

  async closeAutomationContext(serviceId) {
    const context = this.contexts.get(serviceId);
    if (!context) return;
    await context.close().catch(() => {});
    this.contexts.delete(serviceId);
  }

  async closeLoginBrowser(serviceId) {
    const runtime = this.loginBrowsers.get(serviceId);
    if (!runtime?.process) return;

    const child = runtime.process;
    const pid = child.pid;
    if (pid && process.platform === 'win32') {
      await new Promise((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true }, () => resolve());
      });
      await wait(1200);
      if (!child.killed && child.exitCode == null) {
        await new Promise((resolve) => {
          execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
        });
      }
    } else if (!child.killed) {
      child.kill('SIGTERM');
      await wait(700);
    }

    this.loginBrowsers.delete(serviceId);
  }

  async launchNormalLoginBrowser(serviceId) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    await this.closeAutomationContext(serviceId);
    await this.closeLoginBrowser(serviceId);

    const edgePath = this.findEdgeExecutable();
    const profilePath = this.getProfilePath(serviceId);
    fs.mkdirSync(profilePath, { recursive: true });

    const child = spawn(edgePath, [
      `--user-data-dir=${profilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      service.url
    ], {
      detached: false,
      stdio: 'ignore',
      windowsHide: false
    });

    const runtime = { process: child };
    this.loginBrowsers.set(serviceId, runtime);
    child.once('exit', () => {
      const current = this.loginBrowsers.get(serviceId);
      if (current?.process === child) this.loginBrowsers.delete(serviceId);
    });

    this.markProfile(serviceId, { loginMode: 'normal-edge-handoff' });
    return runtime;
  }

  async ensureService(serviceId) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    let context = this.contexts.get(serviceId);
    if (!context) {
      // If the dedicated login window is still open, close it first so Edge flushes
      // the authenticated session to disk and releases the profile lock.
      await this.closeLoginBrowser(serviceId);
      await wait(500);

      fs.mkdirSync(this.getProfilePath(serviceId), { recursive: true });
      context = await chromium.launchPersistentContext(this.getProfilePath(serviceId), {
        channel: 'msedge',
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1280, height: 860 }
      });
      this.contexts.set(serviceId, context);
      this.markProfile(serviceId, { loginMode: 'normal-edge-handoff' });
      context.on('close', () => this.contexts.delete(serviceId));
    }

    let page = context.pages().find((candidate) => candidate.url().startsWith(service.url));
    if (!page) page = context.pages()[0] || await context.newPage();
    if (!page.url().startsWith(service.url)) {
      await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    return { context, page, service };
  }

  async isVisible(locator, timeout = 1200) {
    try {
      await locator.first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async detectAuthState(serviceId, page) {
    const service = SERVICES[serviceId];
    const url = page.url();

    if (service.loginUrlPatterns.some((pattern) => pattern.test(url))) {
      return { status: 'needs-login', message: 'The service is still on a login page.' };
    }

    for (const pattern of service.loggedOutText) {
      const locator = page.getByText(pattern, { exact: true });
      if (await this.isVisible(locator)) {
        return { status: 'needs-login', message: 'A login/sign-up control is visible.' };
      }
    }

    for (const selector of service.authenticatedSelectors) {
      if (await this.isVisible(page.locator(selector), 900)) {
        return { status: 'verified', message: 'Authenticated account UI was detected in the saved Edge profile.' };
      }
    }

    return {
      status: 'unknown',
      message: 'The saved Edge profile opened, but ZeroPOD could not confidently verify whether it is authenticated.'
    };
  }

  async test(serviceId) {
    const { page, service } = await this.ensureService(serviceId);
    await page.bringToFront();

    if (!page.url().startsWith(service.url)) {
      await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } else {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }

    await page.waitForTimeout(1200);
    const result = await this.detectAuthState(serviceId, page);
    this.updateState(serviceId, {
      profileCreated: true,
      loginMode: 'normal-edge-handoff',
      authStatus: result.status,
      lastVerifiedAt: new Date().toISOString(),
      verificationMessage: result.message
    });
    return { ok: result.status !== 'needs-login', serviceId, ...result };
  }

  async preflight(serviceIds = Object.keys(SERVICES)) {
    const results = {};
    for (const serviceId of serviceIds) {
      try {
        results[serviceId] = await this.test(serviceId);
      } catch (error) {
        this.updateState(serviceId, {
          authStatus: 'unknown',
          lastVerifiedAt: new Date().toISOString(),
          verificationMessage: error.message || String(error)
        });
        results[serviceId] = {
          ok: true,
          serviceId,
          status: 'unknown',
          message: error.message || String(error)
        };
      }
    }

    const needsLogin = Object.values(results).filter((item) => item.status === 'needs-login');
    return {
      ok: needsLogin.length === 0,
      results,
      needsLogin: needsLogin.map((item) => item.serviceId)
    };
  }

  async login(serviceId) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    // Authentication happens in a normal Edge process with no Playwright/CDP attachment.
    // Test Session later closes this dedicated login window and reopens the SAME profile
    // under Playwright, preserving the authenticated cookies/session.
    await this.launchNormalLoginBrowser(serviceId);
    this.updateState(serviceId, {
      profileCreated: true,
      loginMode: 'normal-edge-handoff',
      authStatus: 'unknown',
      verificationMessage: 'Normal Microsoft Edge opened. Finish signing in there, then return to ZeroPOD and click Test Session. ZeroPOD will hand off the same saved profile to automation.'
    });
    return {
      ok: true,
      mode: 'normal-edge-handoff',
      message: 'Sign in in normal Edge, then click Test Session.'
    };
  }

  async logout(serviceId) {
    await this.closeAutomationContext(serviceId);
    await this.closeLoginBrowser(serviceId);

    const profilePath = this.getProfilePath(serviceId);
    fs.rmSync(profilePath, { recursive: true, force: true });

    const state = this.readState();
    delete state[serviceId];
    this.writeState(state);
    return { ok: true };
  }

  async openService(serviceId) {
    const { page } = await this.ensureService(serviceId);
    await page.bringToFront();
    return { ok: true };
  }

  async closeAll() {
    for (const serviceId of [...this.contexts.keys()]) {
      await this.closeAutomationContext(serviceId).catch(() => {});
    }
    for (const serviceId of [...this.loginBrowsers.keys()]) {
      await this.closeLoginBrowser(serviceId).catch(() => {});
    }
    this.contexts.clear();
    this.loginBrowsers.clear();
  }
}

module.exports = { SessionManager, SERVICES };
