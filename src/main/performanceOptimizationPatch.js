const fs = require('fs');
const sharp = require('sharp');
const { SessionManager, SERVICES } = require('./sessionManager');
const { ChatGPTController } = require('./chatgptController');
const { MetadataController } = require('./metadataController');
const { VectorizerController } = require('./vectorizerController');
const { ExportController } = require('./exportController');
const { RedbubbleController } = require('./redbubbleController');
const { AutomationQueueController } = require('./automationQueueController');
const { performanceMetrics } = require('./performanceMetrics');

const managerState = new WeakMap();
const preflightState = new WeakMap();

function stateFor(manager) {
  let state = managerState.get(manager);
  if (!state) {
    state = {
      ensureInFlight: new Map(),
      authCache: new Map(),
      warmInFlight: new Map()
    };
    managerState.set(manager, state);
  }
  return state;
}

function serviceUrlMatches(serviceId, value) {
  const service = SERVICES[serviceId];
  if (!service) return false;
  try {
    const current = new URL(String(value || ''));
    const expected = new URL(service.url);
    return current.origin === expected.origin;
  } catch {
    return false;
  }
}

// Deduplicate simultaneous browser startup requests. Several pipeline stages can
// safely prewarm the same service; only one Chrome launch/attach should happen.
const originalEnsureService = SessionManager.prototype.ensureService;
SessionManager.prototype.ensureService = async function ensureServiceOptimized(serviceId) {
  const state = stateFor(this);
  if (state.ensureInFlight.has(serviceId)) return state.ensureInFlight.get(serviceId);

  const hadContext = Boolean(this.contexts?.get(serviceId));
  const started = Date.now();
  const promise = Promise.resolve()
    .then(() => originalEnsureService.call(this, serviceId))
    .then((result) => {
      performanceMetrics.record(`browser:${serviceId}`, Date.now() - started, 'success', { warm: hadContext });
      return result;
    })
    .catch((error) => {
      performanceMetrics.record(`browser:${serviceId}`, Date.now() - started, 'error', { warm: hadContext, message: error.message || String(error) });
      throw error;
    })
    .finally(() => state.ensureInFlight.delete(serviceId));

  state.ensureInFlight.set(serviceId, promise);
  return promise;
};

SessionManager.prototype.warmService = async function warmService(serviceId) {
  const state = stateFor(this);
  if (state.warmInFlight.has(serviceId)) return state.warmInFlight.get(serviceId);

  const promise = this.ensureService(serviceId)
    .then(async ({ page }) => {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      return { ok: true, serviceId, url: page.url() };
    })
    .finally(() => state.warmInFlight.delete(serviceId));

  state.warmInFlight.set(serviceId, promise);
  return promise;
};

SessionManager.prototype.warmServices = async function warmServices(serviceIds = []) {
  const unique = [...new Set(serviceIds.filter((id) => SERVICES[id]))];
  const results = await Promise.allSettled(unique.map((id) => this.warmService(id)));
  return Object.fromEntries(unique.map((id, index) => [id, results[index]]));
};

// Cache a positively verified auth state briefly for internal stage checks. Login
// URLs always invalidate the cache, and the manual Test Session path remains a
// full verification through connectionReliabilityPatch.
const originalDetectAuthState = SessionManager.prototype.detectAuthState;
SessionManager.prototype.detectAuthState = async function detectAuthStateFast(serviceId, page) {
  const service = SERVICES[serviceId];
  const state = stateFor(this);
  const url = page?.url?.() || '';
  const loginVisible = /accounts\.google\.com/i.test(url)
    || service?.loginUrlPatterns?.some((pattern) => pattern.test(url));

  if (loginVisible || !serviceUrlMatches(serviceId, url)) state.authCache.delete(serviceId);
  else {
    const cached = state.authCache.get(serviceId);
    const ttlMs = serviceId === 'chatgpt' ? 60000 : 120000;
    if (cached?.result?.status === 'verified' && Date.now() - cached.at < ttlMs) {
      performanceMetrics.record('auth-cache-hit', 0, 'success', { serviceId });
      return cached.result;
    }
  }

  const result = await originalDetectAuthState.call(this, serviceId, page);
  if (result?.status === 'verified') state.authCache.set(serviceId, { at: Date.now(), result });
  else state.authCache.delete(serviceId);
  return result;
};

const originalLogin = SessionManager.prototype.login;
SessionManager.prototype.login = async function loginInvalidateAuth(serviceId, ...args) {
  stateFor(this).authCache.delete(serviceId);
  return originalLogin.call(this, serviceId, ...args);
};

const originalLogout = SessionManager.prototype.logout;
SessionManager.prototype.logout = async function logoutInvalidateAuth(serviceId, ...args) {
  stateFor(this).authCache.delete(serviceId);
  return originalLogout.call(this, serviceId, ...args);
};

// Connection preflight is independent per site, so run the three browser checks in
// parallel instead of serially waiting for ChatGPT -> Vectorizer -> Redbubble.
SessionManager.prototype.preflight = async function preflightParallel(serviceIds = Object.keys(SERVICES)) {
  const results = {};
  const entries = await Promise.all(serviceIds.map(async (serviceId) => {
    try {
      return [serviceId, await this.test(serviceId)];
    } catch (error) {
      this.updateState(serviceId, {
        authStatus: 'unknown',
        lastVerifiedAt: new Date().toISOString(),
        verificationMessage: error.message || String(error)
      });
      return [serviceId, { ok: false, serviceId, status: 'unknown', message: error.message || String(error) }];
    }
  }));

  for (const [serviceId, result] of entries) results[serviceId] = result;
  const blocked = Object.values(results).filter((item) => ['needs-login', 'human-verification'].includes(item.status) || item.ok === false);
  return {
    ok: blocked.length === 0,
    results,
    needsLogin: blocked.filter((item) => item.status === 'needs-login').map((item) => item.serviceId),
    blocked: blocked.map((item) => item.serviceId)
  };
};

// Validate generated bytes in memory before writing them. This avoids writing the
// image and immediately reopening the same file with Sharp just to read metadata.
ChatGPTController.prototype.saveGeneratedAsset = async function saveGeneratedAssetFast(page, source, projectDir) {
  const { body, contentType } = await this.fetchImageBytes(page, source);
  if (!body || body.length < 8192) throw new Error('Captured generated image was unexpectedly small.');

  let metadata;
  try {
    metadata = await sharp(body, { failOn: 'error' }).metadata();
  } catch {
    throw new Error(`Generated asset is not a supported PNG, WebP, or JPEG image (${contentType || 'unknown MIME'}).`);
  }

  const formats = {
    png: { ext: '.png', mime: 'image/png' },
    jpeg: { ext: '.jpg', mime: 'image/jpeg' },
    jpg: { ext: '.jpg', mime: 'image/jpeg' },
    webp: { ext: '.webp', mime: 'image/webp' }
  };
  const format = formats[String(metadata.format || '').toLowerCase()];
  if (!format) throw new Error(`Generated asset format is unsupported (${metadata.format || contentType || 'unknown'}).`);
  if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) {
    throw new Error(`Generated image dimensions are invalid (${metadata.width || 0}×${metadata.height || 0}).`);
  }

  const savePath = this.nextDraftPath(projectDir, format.ext);
  await fs.promises.writeFile(savePath, body);
  return { savePath, metadata, mime: format.mime };
};

function warmQuietly(controller, serviceId) {
  controller?.sessions?.warmService?.(serviceId).catch(() => {});
}

// Prepare the next service while the current external site is doing the expensive
// work. These warmups do not submit prompts, upload art, or change Redbubble fields.
const originalChatStart = ChatGPTController.prototype.start;
ChatGPTController.prototype.start = async function startWithVectorizerWarmup(payload = {}) {
  const result = await originalChatStart.call(this, payload);
  warmQuietly(this, 'vectorizer');
  return result;
};

const originalMetadataGenerate = MetadataController.prototype.generate;
MetadataController.prototype.generate = async function generateWithWarmup(projectId) {
  warmQuietly(this, 'vectorizer');
  return originalMetadataGenerate.call(this, projectId);
};

const originalVectorizerStart = VectorizerController.prototype.start;
VectorizerController.prototype.start = async function vectorizeWithRedbubbleWarmup(projectId) {
  warmQuietly(this, 'redbubble');
  return originalVectorizerStart.call(this, projectId);
};

VectorizerController.prototype.prewarm = async function prewarmVectorizer() {
  return this.sessions.warmService('vectorizer');
};

RedbubbleController.prototype.prewarm = async function prewarmRedbubble() {
  const { page } = await this.sessions.warmService('redbubble').then(() => this.sessions.ensureService('redbubble'));
  // If Manage Works is already healthy, keep it warm. Never disturb an active copied-work editor.
  if (/\/portfolio\/manage_works/i.test(page.url())) return { ok: true, url: page.url() };
  if (/\/portfolio\/images\//i.test(page.url()) || /\/shop\/ap\//i.test(page.url())) return { ok: true, url: page.url() };
  await page.goto('https://www.redbubble.com/portfolio/manage_works?ref=duplicate_work', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  }).catch(() => {});
  return { ok: true, url: page.url() };
};

const originalOpenManageWorks = RedbubbleController.prototype.openManageWorks;
RedbubbleController.prototype.openManageWorks = async function openManageWorksFast(page) {
  if (/\/portfolio\/manage_works/i.test(page.url())) {
    const ready = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      return /manage portfolio|search your works|works/i.test(body);
    }).catch(() => false);
    if (ready) return true;
  }
  return originalOpenManageWorks.call(this, page);
};

function wrapTimed(proto, methodName, stageName, projectIdIndex = 0) {
  const original = proto[methodName];
  if (typeof original !== 'function') return;
  proto[methodName] = async function timedStage(...args) {
    const started = Date.now();
    try {
      const result = await original.apply(this, args);
      performanceMetrics.record(stageName, Date.now() - started, 'success', { projectId: args[projectIdIndex] || result?.projectId || null });
      return result;
    } catch (error) {
      performanceMetrics.record(stageName, Date.now() - started, 'error', { projectId: args[projectIdIndex] || null, message: error.message || String(error) });
      throw error;
    }
  };
}

// Generation is measured around the background capture watcher, not just prompt submission.
wrapTimed(ChatGPTController.prototype, 'captureGeneratedImage', 'chatgpt-generation', 1);
wrapTimed(MetadataController.prototype, 'generate', 'metadata-generation', 0);
wrapTimed(VectorizerController.prototype, 'start', 'vectorizer', 0);
wrapTimed(ExportController.prototype, 'exportPng', 'export-png', 0);
wrapTimed(RedbubbleController.prototype, 'prepare', 'redbubble-prepare', 0);
wrapTimed(RedbubbleController.prototype, 'publish', 'redbubble-publish', 0);

function sameValue(left, right) {
  if (left === right) return true;
  if ((left === null || left === undefined) && (right === null || right === undefined)) return true;
  return false;
}

// Avoid rewriting the queue JSON when the project-to-row projection did not
// actually change. This removes a large amount of synchronous disk churn while
// Automation is polling a long ChatGPT/Vectorizer/Redbubble operation.
AutomationQueueController.prototype.syncRows = async function syncRowsOptimized() {
  const data = this.store.read();
  const tracked = ['status', 'step', 'checkpoint', 'lastError', 'previewPath', 'publishedUrl', 'listingTitle', 'completedAt'];
  for (const row of data.rows) {
    if (!row.projectId) continue;
    let project;
    try { project = this.projects.read(row.projectId); } catch { continue; }
    const patch = this.mapProjectToRow(project);
    if (!patch || row.status === 'ready') continue;
    const changed = tracked.some((key) => Object.prototype.hasOwnProperty.call(patch, key) && !sameValue(row[key], patch[key]));
    if (changed) this.store.updateRow(row.id, patch);
  }
};

function getPreflightCache(controller) {
  let cache = preflightState.get(controller);
  if (!cache) {
    cache = new Map();
    preflightState.set(controller, cache);
  }
  return cache;
}

async function preflightNextInput(controller, currentRowId) {
  const rows = controller.store.read().rows;
  const next = rows.find((row) => row.id !== currentRowId
    && row.enabled
    && !row.projectId
    && ['pending', 'ready'].includes(row.status)
    && row.referenceImage
    && row.amazonLink);
  if (!next) return null;

  const signature = `${next.referenceImage}|${next.amazonLink}`;
  const cache = getPreflightCache(controller);
  if (cache.get(next.id)?.signature === signature) return cache.get(next.id);

  const started = Date.now();
  let result;
  try {
    await fs.promises.access(next.referenceImage, fs.constants.R_OK);
    const url = new URL(String(next.amazonLink));
    if (!/^https?:$/.test(url.protocol)) throw new Error('Source URL must use HTTP or HTTPS.');
    result = { signature, ok: true, checkedAt: Date.now() };
    performanceMetrics.record('next-job-preflight', Date.now() - started, 'success', { rowId: next.id });
    controller.chatgpt?.sessions?.warmService?.('chatgpt').catch(() => {});
  } catch (error) {
    result = { signature, ok: false, error: error.message || String(error), checkedAt: Date.now() };
    performanceMetrics.record('next-job-preflight', Date.now() - started, 'error', { rowId: next.id, message: result.error });
  }
  cache.set(next.id, result);
  return result;
}

const originalProcessRow = AutomationQueueController.prototype.processRow;
AutomationQueueController.prototype.processRow = async function processRowOptimized(row) {
  preflightNextInput(this, row.id).catch(() => {});

  if (row.projectId) {
    try {
      const project = this.projects.read(row.projectId);
      if (['approved-image', 'metadata-generating', 'metadata-ready'].includes(project.status)) {
        this.vectorizer?.prewarm?.().catch(() => {});
      }
      if (['vectorizing', 'vector-ready', 'export-ready'].includes(project.status)) {
        this.redbubble?.prewarm?.().catch(() => {});
      }
    } catch {}
  }

  return originalProcessRow.call(this, row);
};

module.exports = { performanceMetrics };
