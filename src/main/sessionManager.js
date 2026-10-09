const { app, safeStorage } = require('electron');
const { chromium } = require('playwright');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

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
    this.externalBrowsers = new Map();
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
          loginMode: state[id]?.loginMode || 'edge-compatibility',
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

  async getFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = address.port;
        server.close(() => resolve(port));
      });
    });
  }

  async waitForCdp(port, timeoutMs = 20000) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < timeoutMs) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) return true;
      } catch (error) {
        lastError = error;
      }
      await wait(300);
    }
    throw new Error(`Edge compatibility browser did not expose its local automation endpoint.${lastError ? ` ${lastError.message}` : ''}`);
  }

  async launchExternalEdge(serviceId, { focusUrl = true } = {}) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    const existing = this.externalBrowsers.get(serviceId);
    if (existing?.port) {
      try {
        await this.waitForCdp(existing.port, 1200);
        return existing;
      } catch {
        this.externalBrowsers.delete(serviceId);
      }
    }

    const edgePath = this.findEdgeExecutable();
    const profilePath = this.getProfilePath(serviceId);
    fs.mkdirSync(profilePath, { recursive: true });
    const port = await this.getFreePort();
    const args = [
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      focusUrl ? service.url : 'about:blank'
    ];

    const child = spawn(edgePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false
    });

    const runtime = { process: child, port, browser: null, context: null };
    this.externalBrowsers.set(serviceId, runtime);
    child.once('exit', () => {
      const current = this.externalBrowsers.get(serviceId);
      if (current?.process === child) this.externalBrowsers.delete(serviceId);
      this.contexts.delete(serviceId);
    });

    await this.waitForCdp(port);
    this.markProfile(serviceId, { loginMode: 'edge-compatibility' });
    return runtime;
  }

  async connectExternalEdge(serviceId) {
    const runtime = await this.launchExternalEdge(serviceId, { focusUrl: true });
    if (!runtime.browser) {
      runtime.browser = await chromium.connectOverCDP(`http://127.0.0.1:${runtime.port}`);
      const contexts = runtime.browser.contexts();
      runtime.context = contexts[0] || null;
      if (!runtime.context) throw new Error('Could not attach ZeroPOD to the Edge login profile.');
      this.contexts.set(serviceId, runtime.context);
      runtime.browser.on('disconnected', () => {
        this.contexts.delete(serviceId);
        const current = this.externalBrowsers.get(serviceId);
        if (current) {
          current.browser = null;
          current.context = null;
        }
      });
    }
    return runtime;
  }

  async ensureService(serviceId) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    const runtime = await this.connectExternalEdge(serviceId);
    let page = runtime.context.pages().find((candidate) => candidate.url().startsWith(service.url));
    if (!page) page = runtime.context.pages()[0] || await runtime.context.newPage();
    if (!page.url().startsWith(service.url)) {
      await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    return { context: runtime.context, page, service };
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
        return { status: 'verified', message: 'Authenticated account UI was detected in the normal Edge profile.' };
      }
    }

    return {
      status: 'unknown',
      message: 'The Edge profile is saved, but ZeroPOD could not confidently verify whether it is authenticated.'
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
      loginMode: 'edge-compatibility',
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

    // Important: launch normal Edge and deliberately do NOT attach Playwright yet.
    // This lets Google/email/password/2FA/CAPTCHA run in the normal browser environment.
    await this.launchExternalEdge(serviceId, { focusUrl: true });
    this.updateState(serviceId, {
      profileCreated: true,
      loginMode: 'edge-compatibility',
      authStatus: 'unknown',
      verificationMessage: 'Normal Microsoft Edge opened. Finish signing in there, including Google/2FA if needed, then return to ZeroPOD and click Test Session.'
    });
    return {
      ok: true,
      mode: 'edge-compatibility',
      message: 'Sign in in the normal Edge window, then click Test Session.'
    };
  }

  async terminateExternal(serviceId) {
    const runtime = this.externalBrowsers.get(serviceId);
    if (!runtime) return;

    if (runtime.browser) {
      await runtime.browser.close().catch(() => {});
    }

    const pid = runtime.process?.pid;
    if (pid && process.platform === 'win32') {
      await new Promise((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      });
    } else if (runtime.process && !runtime.process.killed) {
      runtime.process.kill();
    }

    this.externalBrowsers.delete(serviceId);
    this.contexts.delete(serviceId);
  }

  async logout(serviceId) {
    await this.terminateExternal(serviceId);

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
    for (const serviceId of [...this.externalBrowsers.keys()]) {
      await this.terminateExternal(serviceId).catch(() => {});
    }
    this.contexts.clear();
  }
}

module.exports = { SessionManager, SERVICES };
