const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const redbubbleModule = require('./redbubbleController');
const { RedbubbleController } = redbubbleModule;
const { AutomationQueueStore } = require('./automationQueueStore');
const { detectUploadLimitPage, readLimitState } = require('./redbubbleDailyLimitPatch');

const MANAGE_WORKS_URL = 'https://www.redbubble.com/portfolio/manage_works?ref=duplicate_work';
const SETTINGS_FILE = 'redbubble-limit-check-settings.json';
const LIMIT_STATE_FILE = 'redbubble-upload-limit-state.json';
const ALLOWED_INTERVALS = [1, 2, 4, 8, 12, 24];
const DEFAULT_INTERVAL_HOURS = 1;
const HOUR_MS = 60 * 60 * 1000;

function settingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function limitStatePath() {
  return path.join(app.getPath('userData'), LIMIT_STATE_FILE);
}

function normalizeInterval(value) {
  const numeric = Number(value);
  return ALLOWED_INTERVALS.includes(numeric) ? numeric : DEFAULT_INTERVAL_HOURS;
}

function normalizeSettings(value = {}) {
  return {
    intervalHours: normalizeInterval(value.intervalHours),
    lastCheckedAt: value.lastCheckedAt || null,
    lastCheckResult: value.lastCheckResult || null,
    lastCheckMessage: value.lastCheckMessage || null,
    lastCheckSource: value.lastCheckSource || null,
    nextCheckAt: value.nextCheckAt || null,
    deferredBecauseAutomation: Boolean(value.deferredBecauseAutomation)
  };
}

function readSettings() {
  try {
    const file = settingsPath();
    if (!fs.existsSync(file)) return normalizeSettings();
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalizeSettings();
  }
}

function writeSettings(patch = {}) {
  const next = normalizeSettings({ ...readSettings(), ...patch });
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function ensureNextCheck(settings = readSettings()) {
  if (settings.nextCheckAt) return settings;
  return writeSettings({
    nextCheckAt: new Date(Date.now() + settings.intervalHours * HOUR_MS).toISOString()
  });
}

function writeLimitState(patch = {}) {
  const previous = readLimitState();
  const next = { ...previous, ...patch };
  const file = limitStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function markLimitAvailable() {
  return writeLimitState({
    blocked: false,
    clearedAt: new Date().toISOString(),
    message: null,
    url: null
  });
}

function markLimitDetected(info = {}) {
  const previous = readLimitState();
  return writeLimitState({
    blocked: true,
    detectedAt: previous.blocked && previous.detectedAt ? previous.detectedAt : new Date().toISOString(),
    message: info.message || "Redbubble reported that you've exceeded your upload limit and you'll be able to upload again tomorrow.",
    url: info.url || previous.url || null
  });
}

function recordCheck({ result, message, source }) {
  const current = readSettings();
  const now = new Date();
  return writeSettings({
    lastCheckedAt: now.toISOString(),
    lastCheckResult: result,
    lastCheckMessage: message || null,
    lastCheckSource: source || 'manual',
    nextCheckAt: new Date(now.getTime() + current.intervalHours * HOUR_MS).toISOString(),
    deferredBecauseAutomation: false
  });
}

async function safeReturnToManageWorks(page) {
  if (!page) return;
  await page.goto(MANAGE_WORKS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
}

RedbubbleController.prototype.attachAutomationStore = function attachAutomationStore(store) {
  this.limitCheckAutomationStore = store || null;
  return this;
};

RedbubbleController.prototype.getLimitCheckSettings = function getLimitCheckSettings() {
  const settings = ensureNextCheck();
  return { ...settings, allowedIntervals: ALLOWED_INTERVALS };
};

RedbubbleController.prototype.updateLimitCheckSettings = function updateLimitCheckSettings(patch = {}) {
  const intervalHours = normalizeInterval(patch.intervalHours);
  const next = writeSettings({
    intervalHours,
    nextCheckAt: new Date(Date.now() + intervalHours * HOUR_MS).toISOString(),
    deferredBecauseAutomation: false
  });
  return { ...next, allowedIntervals: ALLOWED_INTERVALS };
};

RedbubbleController.prototype.checkUploadLimit = async function checkUploadLimit(options = {}) {
  const source = options.source === 'automatic' ? 'automatic' : 'manual';
  if (this.limitCheckInProgress) {
    return {
      ok: false,
      status: 'busy',
      message: 'A Redbubble upload-limit check is already running.',
      settings: this.getLimitCheckSettings()
    };
  }

  const queueState = this.limitCheckAutomationStore?.read?.().state || null;
  if (queueState === 'running') {
    if (source === 'automatic') {
      const settings = writeSettings({ deferredBecauseAutomation: true });
      return {
        ok: false,
        skipped: true,
        status: 'deferred',
        message: 'Automatic Redbubble limit check is due and will run as soon as Automation is no longer running.',
        settings: { ...settings, allowedIntervals: ALLOWED_INTERVALS }
      };
    }
    return {
      ok: false,
      status: 'automation-running',
      message: 'Pause Automation before running a manual Redbubble upload-limit check.',
      settings: this.getLimitCheckSettings()
    };
  }

  this.limitCheckInProgress = true;
  let page = null;
  try {
    ({ page } = await this.sessions.ensureService('redbubble'));
    await page.bringToFront().catch(() => {});

    try {
      await this.openManageWorks(page);
    } catch (error) {
      const directLimit = await detectUploadLimitPage(page).catch(() => ({ detected: false }));
      if (!directLimit.detected) throw error;
      markLimitDetected(directLimit);
      const settings = recordCheck({ result: 'limited', message: directLimit.message, source });
      await safeReturnToManageWorks(page);
      return {
        ok: true,
        limited: true,
        status: 'limited',
        message: directLimit.message,
        checkedAt: settings.lastCheckedAt,
        settings: { ...settings, allowedIntervals: ALLOWED_INTERVALS }
      };
    }

    const beforeCopyLimit = await detectUploadLimitPage(page).catch(() => ({ detected: false }));
    if (beforeCopyLimit.detected) {
      markLimitDetected(beforeCopyLimit);
      const settings = recordCheck({ result: 'limited', message: beforeCopyLimit.message, source });
      await safeReturnToManageWorks(page);
      return {
        ok: true,
        limited: true,
        status: 'limited',
        message: beforeCopyLimit.message,
        checkedAt: settings.lastCheckedAt,
        settings: { ...settings, allowedIntervals: ALLOWED_INTERVALS }
      };
    }

    try {
      await this.openFirstCopySettings(page);
    } catch (error) {
      const detected = await detectUploadLimitPage(page).catch(() => ({ detected: false }));
      if (error?.code === 'REDBUBBLE_UPLOAD_LIMIT_DETECTED' || detected.detected) {
        const info = detected.detected
          ? detected
          : { detected: true, message: error.message, url: error.url || page.url() };
        markLimitDetected(info);
        const settings = recordCheck({ result: 'limited', message: info.message, source });
        await safeReturnToManageWorks(page);
        return {
          ok: true,
          limited: true,
          status: 'limited',
          message: info.message,
          checkedAt: settings.lastCheckedAt,
          settings: { ...settings, allowedIntervals: ALLOWED_INTERVALS }
        };
      }
      throw error;
    }

    // Reaching the copied-work editor proves Redbubble currently permits the
    // duplicate workflow. Never replace artwork, edit fields, or save anything.
    markLimitAvailable();
    const availableMessage = 'Redbubble Copy Settings opened normally. Upload capacity is currently available.';
    const settings = recordCheck({ result: 'available', message: availableMessage, source });
    await safeReturnToManageWorks(page);
    return {
      ok: true,
      limited: false,
      status: 'available',
      message: availableMessage,
      checkedAt: settings.lastCheckedAt,
      settings: { ...settings, allowedIntervals: ALLOWED_INTERVALS }
    };
  } catch (error) {
    const message = error?.message || String(error);
    const settings = recordCheck({ result: 'error', message, source });
    await safeReturnToManageWorks(page);
    return {
      ok: false,
      limited: null,
      status: 'error',
      message,
      checkedAt: settings.lastCheckedAt,
      settings: { ...settings, allowedIntervals: ALLOWED_INTERVALS }
    };
  } finally {
    this.limitCheckInProgress = false;
  }
};

RedbubbleController.prototype.startUploadLimitScheduler = function startUploadLimitScheduler() {
  if (this.limitCheckScheduler) return;
  ensureNextCheck();

  const tick = async () => {
    try {
      const settings = ensureNextCheck();
      const dueAt = Date.parse(settings.nextCheckAt || '');
      if (!Number.isFinite(dueAt) || Date.now() < dueAt) return;

      const queueState = this.limitCheckAutomationStore?.read?.().state || null;
      if (queueState === 'running') {
        if (!settings.deferredBecauseAutomation) writeSettings({ deferredBecauseAutomation: true });
        return;
      }

      await this.checkUploadLimit({ source: 'automatic' });
    } catch {}
  };

  this.limitCheckScheduler = setInterval(tick, 60 * 1000);
  setTimeout(tick, 5000);
};

// bootstrap loads this patch before main.js. Replace the exported class with a
// tiny tracked subclass so the main process Redbubble instance can expose the
// checker through IPC without changing the proven controller construction flow.
let activeController = null;
class LimitCheckRedbubbleController extends RedbubbleController {
  constructor(options) {
    super(options);
    activeController = this;
    this.attachAutomationStore(new AutomationQueueStore());
  }
}
redbubbleModule.RedbubbleController = LimitCheckRedbubbleController;

app.whenReady().then(() => {
  ipcMain.handle('redbubble:check-upload-limit', () => {
    if (!activeController) throw new Error('Redbubble controller is not ready yet.');
    return activeController.checkUploadLimit({ source: 'manual' });
  });
  ipcMain.handle('redbubble:limit-check-settings', () => {
    if (!activeController) throw new Error('Redbubble controller is not ready yet.');
    return activeController.getLimitCheckSettings();
  });
  ipcMain.handle('redbubble:update-limit-check-settings', (_event, patch) => {
    if (!activeController) throw new Error('Redbubble controller is not ready yet.');
    return activeController.updateLimitCheckSettings(patch || {});
  });
  activeController?.startUploadLimitScheduler();
});

module.exports = {
  ALLOWED_INTERVALS,
  DEFAULT_INTERVAL_HOURS,
  readSettings,
  writeSettings
};
