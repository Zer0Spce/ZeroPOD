const { app, safeStorage } = require('electron');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SERVICES = {
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  vectorizer: { name: 'Vectorizer.ai', url: 'https://vectorizer.ai/' },
  redbubble: { name: 'Redbubble', url: 'https://www.redbubble.com/' }
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

  getStatuses() {
    const state = this.readState();
    return Object.fromEntries(
      Object.entries(SERVICES).map(([id, service]) => [id, {
        id,
        name: service.name,
        connected: Boolean(state[id]?.profileCreated),
        lastConnectedAt: state[id]?.lastConnectedAt || null
      }])
    );
  }

  async login(serviceId) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);

    fs.mkdirSync(this.getProfilePath(serviceId), { recursive: true });

    if (this.contexts.has(serviceId)) {
      const existing = this.contexts.get(serviceId);
      const pages = existing.pages();
      if (pages[0]) await pages[0].bringToFront();
      return { ok: true, alreadyOpen: true };
    }

    const context = await chromium.launchPersistentContext(this.getProfilePath(serviceId), {
      channel: 'msedge',
      headless: false,
      viewport: { width: 1280, height: 860 }
    });

    this.contexts.set(serviceId, context);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(service.url, { waitUntil: 'domcontentloaded' });

    context.on('close', () => {
      this.contexts.delete(serviceId);
      const state = this.readState();
      state[serviceId] = {
        profileCreated: true,
        lastConnectedAt: new Date().toISOString()
      };
      this.writeState(state);
    });

    return { ok: true, alreadyOpen: false };
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
