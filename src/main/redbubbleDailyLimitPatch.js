const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { RedbubbleController } = require('./redbubbleController');
const { ProjectStore } = require('./projectStore');

// Redbubble's 30-work figure is kept only as informational context for the
// dashboard. It is NOT used to decide whether publishing is allowed.
const DAILY_LIMIT = 30;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const LIMIT_STATE_FILE = 'redbubble-upload-limit-state.json';

function statePath() {
  return path.join(app.getPath('userData'), LIMIT_STATE_FILE);
}

function readLimitState() {
  try {
    const file = statePath();
    if (!fs.existsSync(file)) return { blocked: false, detectedAt: null, clearedAt: null };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      blocked: Boolean(parsed.blocked),
      detectedAt: parsed.detectedAt || null,
      clearedAt: parsed.clearedAt || null,
      message: parsed.message || null,
      url: parsed.url || null
    };
  } catch {
    return { blocked: false, detectedAt: null, clearedAt: null };
  }
}

function writeLimitState(patch = {}) {
  const next = { ...readLimitState(), ...patch };
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function localPublishHistory(projects) {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  return projects.list({ includeArchived: true })
    .map((project) => Date.parse(project.redbubble?.publishedAt || ''))
    .filter((value) => Number.isFinite(value) && value > cutoff && value <= now)
    .sort((a, b) => a - b);
}

function getUsage(projects) {
  const timestamps = localPublishHistory(projects);
  const state = readLimitState();
  return {
    limit: DAILY_LIMIT,
    count: timestamps.length,
    localCount: timestamps.length,
    windowHours: 24,
    blocked: state.blocked,
    detectedAt: state.detectedAt,
    clearedAt: state.clearedAt,
    message: state.message,
    url: state.url,
    source: state.blocked ? 'redbubble-page' : 'none',
    // Legacy fields retained for compatibility. They no longer enforce anything.
    remaining: null,
    nextSlotAt: null
  };
}

function normalizeBody(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function limitMessageFromBody(body) {
  const text = normalizeBody(body);
  const exceeded = /you(?:'|’)?ve exceeded your upload limit/i.test(text)
    || /exceeded (?:your )?upload limit/i.test(text);
  const tomorrow = /you(?:'|’)?ll be able to upload again tomorrow/i.test(text);
  const uhOh = /uh[-\s]?oh/i.test(text);
  if (!exceeded) return null;
  if (!tomorrow && !uhOh && !/upload limit/i.test(text)) return null;
  return "Redbubble reported that you've exceeded your upload limit and you'll be able to upload again tomorrow.";
}

async function detectUploadLimitPage(page) {
  if (!page) return { detected: false, message: null, url: null };
  const body = await page.locator('body').innerText().catch(() => '');
  const message = limitMessageFromBody(body);
  return { detected: Boolean(message), message, url: page.url() };
}

function markLimitDetected(info = {}) {
  const previous = readLimitState();
  return writeLimitState({
    blocked: true,
    detectedAt: previous.blocked && previous.detectedAt ? previous.detectedAt : new Date().toISOString(),
    message: info.message || "Redbubble reported that you've exceeded your upload limit.",
    url: info.url || previous.url || null
  });
}

function markLimitCleared() {
  return writeLimitState({
    blocked: false,
    clearedAt: new Date().toISOString(),
    message: null,
    url: null
  });
}

RedbubbleController.prototype.getDailyUploadUsage = function getDailyUploadUsage() {
  return getUsage(this.projects);
};

// Use the controller's normal successful-publish signals, but give the real
// Redbubble upload-limit page priority. A redirect to that error page must never
// be mistaken for a successful publish.
RedbubbleController.prototype.detectPublishSuccess = async function detectPublishSuccessWithLimit(page, beforeUrl) {
  const successText = /successfully published|your work has been published|work published|published successfully|work saved|saved successfully/i;

  for (let i = 0; i < 45; i += 1) {
    const url = page.url();
    const body = await page.locator('body').innerText().catch(() => '');
    const limitMessage = limitMessageFromBody(body);
    if (limitMessage) {
      const info = { detected: true, message: limitMessage, url };
      markLimitDetected(info);
      return { verified: false, uploadLimit: true, ...info };
    }

    const saveStillVisible = await page.getByRole('button', { name: /save work|publish|submit/i }).last().isVisible().catch(() => false);
    const urlLooksFinal = url !== beforeUrl
      && /redbubble\.com\/(people|i|shop|portfolio|studio|manage|works?)/i.test(url)
      && !/duplicate|edit|upload/i.test(url);

    if (successText.test(body) || urlLooksFinal || (!saveStillVisible && url !== beforeUrl)) {
      return { verified: true, url };
    }

    await page.waitForTimeout(1000);
  }

  return { verified: false, url: page.url() };
};

const originalPublish = RedbubbleController.prototype.publish;
RedbubbleController.prototype.publish = async function publishWithRealLimitDetection(projectId) {
  const convertVisibleLimitToError = async () => {
    let page = null;
    try {
      ({ page } = await this.sessions.ensureService('redbubble'));
    } catch {}

    const detected = await detectUploadLimitPage(page).catch(() => ({ detected: false }));
    if (!detected.detected) return null;

    const info = { message: detected.message, url: detected.url };
    markLimitDetected(info);

    const current = this.projects.read(projectId);
    this.projects.update(projectId, {
      // The limit page means Redbubble rejected this submission. Return to
      // review so a later retry clicks Save Work again after the limit resets.
      status: 'redbubble-review',
      lastAutomationError: {
        service: 'Redbubble',
        step: 'upload-limit-detected',
        message: info.message || 'Redbubble reported that the upload limit has been reached.',
        at: new Date().toISOString(),
        recovery: 'This limit came directly from the Redbubble page. ZeroPOD will not guess the reset from local upload counts. Retry later; once Redbubble accepts a new publish, ZeroPOD will automatically clear this limit status.'
      },
      redbubble: {
        ...(current.redbubble || {}),
        uploadLimitDetectedAt: new Date().toISOString(),
        uploadLimitMessage: info.message || null,
        uploadLimitUrl: info.url || null
      }
    });

    const error = new Error(info.message || 'Redbubble upload limit detected.');
    error.code = 'REDBUBBLE_UPLOAD_LIMIT_DETECTED';
    error.source = 'redbubble-page';
    return error;
  };

  try {
    // Never block before attempting publish based on local counts.
    const result = await originalPublish.call(this, projectId);

    if (result?.ok && result?.verified) {
      const previous = readLimitState();
      if (previous.blocked) markLimitCleared();
      const published = this.projects.read(projectId);
      this.projects.update(projectId, {
        redbubble: {
          ...(published.redbubble || {}),
          uploadLimitClearedAt: previous.blocked
            ? new Date().toISOString()
            : (published.redbubble?.uploadLimitClearedAt || null)
        }
      });
      return result;
    }

    const limitError = await convertVisibleLimitToError();
    if (limitError) throw limitError;
    return result;
  } catch (error) {
    if (error?.code === 'REDBUBBLE_UPLOAD_LIMIT_DETECTED') throw error;
    const limitError = await convertVisibleLimitToError();
    if (limitError) throw limitError;
    throw error;
  }
};

app.whenReady().then(() => {
  const projects = new ProjectStore();
  ipcMain.handle('redbubble:daily-usage', () => getUsage(projects));
});

module.exports = {
  DAILY_LIMIT,
  WINDOW_MS,
  getUsage,
  limitMessageFromBody,
  detectUploadLimitPage,
  readLimitState
};
