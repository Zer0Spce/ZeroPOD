const { app, safeStorage } = require('electron');
const { chromium } = require('playwright');
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

class SessionManager {
  constructor() {
    this.contexts = new Map();
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

  markProfile(serviceId) {
    this.updateState(serviceId, {
      profileCreated: true,
      authStatus: this.readState()[serviceId]?.authStatus || 'unknown',
      lastConnectedAt: new Date().toISOString()
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
          lastConnectedAt: state[id]?.lastConnectedAt || null,
          lastVerifiedAt: state[id]?.lastVerifiedAt || null,
          verificationMessage: state[id]?.verificationMessage || null
        }];
      })
    );
  }

  async ensureService(serviceId) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    fs.mkdirSync(this.getProfilePath(serviceId), { recursive: true });

    let context = this.contexts.get(serviceId);
    if (!context) {
      context = await chromium.launchPersistentContext(this.getProfilePath(serviceId), {
        channel: 'msedge',
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1280, height: 860 }
      });
      this.contexts.set(serviceId, context);
      this.markProfile(serviceId);
      context.on('close', () => this.contexts.delete(serviceId));
    }

    let page = context.pages()[0];
    if (!page) page = await context.newPage();
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
      return { status: 'needs-login', message: 'The service redirected to a login page.' };
    }

    for (const pattern of service.loggedOutText) {
      const locator = page.getByText(pattern, { exact: true });
      if (await this.isVisible(locator)) {
        return { status: 'needs-login', message: 'A login/sign-up control is visible.' };
      }
    }

    for (const selector of service.authenticatedSelectors) {
      if (await this.isVisible(page.locator(selector), 900)) {
        return { status: 'verified', message: 'Authenticated account UI was detected.' };
      }
    }

    return {
      status: 'unknown',
      message: 'A saved browser session exists, but ZeroPOD could not confidently verify whether it is still authenticated.'
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
    const { page, service } = await this.ensureService(serviceId);
    await page.bringToFront();
    if (!page.url().startsWith(service.url)) {
      await page.goto(service.url, { waitUntil: 'domcontentloaded' });
    }
    this.updateState(serviceId, {
      profileCreated: true,
      authStatus: 'unknown',
      verificationMessage: 'Login window opened. Sign in normally, then click Test Session in ZeroPOD.'
    });
    return { ok: true, alreadyOpen: true };
  }

  async logout(serviceId) {
    const context = this.contexts.get(serviceId);
    if (context) {
      await context.close().catch(() => {});
      this.contexts.delete(serviceId);
    }

    const profilePath = this.getProfilePath(serviceId);
    fs.rmSync(profilePath, { recursive: true, force: true });

    const state = this.readState();
    delete state[serviceId];
    this.writeState(state);
    return { ok: true };
  }

  async openService(serviceId) {
    return this.login(serviceId);
  }

  async closeAll() {
    for (const context of this.contexts.values()) {
      await context.close().catch(() => {});
    }
    this.contexts.clear();
  }
}

module.exports = { SessionManager, SERVICES };
