const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { clickFirstVisible } = require('./automationUtils');
const { RedbubbleController } = require('./redbubbleController');
const { AutomationQueueController } = require('./automationQueueController');
const { detectUploadLimitPage, readLimitState } = require('./redbubbleDailyLimitPatch');

const LIMIT_STATE_FILE = 'redbubble-upload-limit-state.json';
const LIMIT_ERROR_CODE = 'REDBUBBLE_UPLOAD_LIMIT_DETECTED';

function limitStatePath() {
  return path.join(app.getPath('userData'), LIMIT_STATE_FILE);
}

function markLimitDetected(info = {}) {
  const previous = readLimitState();
  const next = {
    ...previous,
    blocked: true,
    detectedAt: previous.blocked && previous.detectedAt ? previous.detectedAt : new Date().toISOString(),
    message: info.message || "Redbubble reported that you've exceeded your upload limit and you'll be able to upload again tomorrow.",
    url: info.url || previous.url || null
  };
  const file = limitStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function makeLimitError(info = {}) {
  const error = new Error(info.message || "Redbubble reported that you've exceeded your upload limit and you'll be able to upload again tomorrow.");
  error.code = LIMIT_ERROR_CODE;
  error.source = 'redbubble-page';
  error.url = info.url || null;
  return error;
}

async function detectAndThrowLimit(page) {
  const detected = await detectUploadLimitPage(page).catch(() => ({ detected: false }));
  if (!detected.detected) return false;
  markLimitDetected(detected);
  throw makeLimitError(detected);
}

// Redbubble can enforce the upload cap as soon as Copy Settings opens the
// /duplicate page, before ZeroPOD ever reaches the final Publish button.
// Detect that page while we are waiting for the copied-work editor so a real
// upload-limit response is never misreported as a settings-circle failure.
RedbubbleController.prototype.openFirstCopySettings = async function openFirstCopySettingsWithLimitDetection(page) {
  await detectAndThrowLimit(page);
  await this.clickFirstSettingsGear(page);

  const clicked = await clickFirstVisible([
    page.getByRole('link', { name: /^copy settings$/i }).first(),
    page.getByRole('button', { name: /^copy settings$/i }).first(),
    page.getByText(/^copy settings$/i, { exact: true }).first(),
    page.locator('a[href*="/duplicate"]').first()
  ], { timeout: 7000 }).catch(() => false);

  if (!clicked) {
    await detectAndThrowLimit(page);
    const actions = await page.locator('a, button, [role="menuitem"]').evaluateAll((els) => els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
      .slice(0, 40)).catch(() => []);
    throw new Error(`Copy settings was not found after opening the first work settings menu. Visible actions: ${actions.join(' | ').slice(0, 800)}`);
  }

  const started = Date.now();
  while (Date.now() - started < 25000) {
    await detectAndThrowLimit(page);

    const replace = page.getByRole('button', { name: /replace all images/i }).first();
    const titleCount = await page.locator('input[name="title"], input[id*="title" i], input[placeholder*="title" i]').count().catch(() => 0);
    const body = await page.locator('body').innerText().catch(() => '');
    if (await replace.isVisible().catch(() => false)) return true;
    if (titleCount && /main tag/i.test(body) && /supporting tags/i.test(body)) return true;

    await page.waitForTimeout(250);
  }

  await detectAndThrowLimit(page);
  throw new Error('Redbubble Copy settings opened, but the copied-work editor did not become ready.');
};

const originalPrepare = RedbubbleController.prototype.prepare;
RedbubbleController.prototype.prepare = async function prepareWithUploadLimitDetection(projectId) {
  try {
    return await originalPrepare.call(this, projectId);
  } catch (error) {
    let detected = null;
    try {
      const { page } = await this.sessions.ensureService('redbubble');
      detected = await detectUploadLimitPage(page);
    } catch {}

    const isLimit = error?.code === LIMIT_ERROR_CODE || detected?.detected;
    if (!isLimit) throw error;

    const info = detected?.detected
      ? detected
      : { detected: true, message: error.message, url: error.url || null };
    markLimitDetected(info);

    try {
      const current = this.projects.read(projectId);
      this.projects.update(projectId, {
        status: 'redbubble-recovery-needed',
        lastAutomationError: {
          service: 'Redbubble',
          step: 'upload-limit-detected',
          message: info.message || error.message,
          at: new Date().toISOString(),
          recovery: 'Redbubble itself reported the upload limit. ZeroPOD paused Automation and preserved this job. Retry later; ZeroPOD will restart from the Redbubble step instead of regenerating the design.'
        },
        redbubble: {
          ...(current.redbubble || {}),
          uploadLimitDetectedAt: new Date().toISOString(),
          uploadLimitMessage: info.message || error.message,
          uploadLimitUrl: info.url || null
        }
      });
    } catch {}

    throw makeLimitError(info);
  }
};

function looksLikePriorLimitMisclassification(row) {
  const text = `${row?.step || ''} ${row?.lastError || ''}`;
  return row?.status === 'needs-attention' && /copy settings from first work failed|first redbubble work settings circle|copied-work editor did not become ready|redbubble needs attention/i.test(text);
}

function pauseAutomationForLimit(controller, currentRow, message) {
  const data = controller.store.read();
  const patches = [];
  let recoveredRows = 0;

  for (const row of data.rows) {
    if (row.id === currentRow.id) continue;
    if (!looksLikePriorLimitMisclassification(row)) continue;
    patches.push({
      rowId: row.id,
      patch: {
        status: 'ready',
        step: 'Paused · Redbubble upload limit reached',
        checkpoint: 'redbubble-upload-limit',
        lastError: null
      }
    });
    recoveredRows += 1;
  }

  patches.push({
    rowId: currentRow.id,
    patch: {
      status: 'ready',
      step: 'Paused · Redbubble upload limit reached',
      checkpoint: 'redbubble-upload-limit',
      lastError: null
    }
  });

  controller.store.updateManyRows(patches);
  controller.store.setState('paused', {
    recovery: {
      type: 'redbubble-upload-limit',
      at: new Date().toISOString(),
      recoveredRows,
      message: message || "Redbubble reported that you've exceeded your upload limit. Automation is paused and unfinished jobs were preserved."
    }
  });
}

// automationFullAutoPatch replaces processRow, so this file must be required
// after it. Convert the special Redbubble limit signal into a queue pause rather
// than the generic runLoop failure path.
const originalProcessRow = AutomationQueueController.prototype.processRow;
AutomationQueueController.prototype.processRow = async function processRowWithUploadLimitPause(row) {
  try {
    return await originalProcessRow.call(this, row);
  } catch (error) {
    if (error?.code !== LIMIT_ERROR_CODE) throw error;
    pauseAutomationForLimit(this, row, error.message);
    return null;
  }
};

module.exports = { LIMIT_ERROR_CODE };
