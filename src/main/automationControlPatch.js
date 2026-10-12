const { app, ipcMain } = require('electron');
const fs = require('fs');
const { AutomationQueueController } = require('./automationQueueController');
const { AutomationQueueStore } = require('./automationQueueStore');
const { ProjectStore } = require('./projectStore');
const { SessionManager } = require('./sessionManager');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let forceStoppingAutomation = false;

function forceStopError(service, step) {
  return {
    service,
    step,
    code: 'ZEROPOD_FORCE_STOP',
    message: 'Stopped by user with Force Stop.',
    recovery: 'The project was preserved at a safe retry point. Start or resume it again when ready.',
    at: new Date().toISOString()
  };
}

function moveProjectToSafeRetry(projects, projectId) {
  if (!projectId) return null;
  let project;
  try { project = projects.read(projectId); } catch { return null; }

  const patch = {};
  if (['generating', 'regenerating'].includes(project.status)) {
    if (project.generatedImagePath && fs.existsSync(project.generatedImagePath)) {
      patch.status = 'awaiting-review';
      patch.automationStep = 'Force stopped · generated image preserved';
    } else {
      patch.status = 'chatgpt-recovery-needed';
      patch.automationStep = 'Force stopped · retry ChatGPT';
      patch.chatgptError = forceStopError('ChatGPT', 'force-stop');
    }
  } else if (project.status === 'metadata-generating') {
    patch.status = project.metadata ? 'metadata-ready' : 'metadata-recovery-needed';
    patch.automationStep = project.metadata ? 'Force stopped · metadata preserved' : 'Force stopped · retry metadata';
    if (!project.metadata) patch.metadataError = forceStopError('ChatGPT', 'force-stop-metadata');
  } else if (['vectorizing', 'vectorizer-manual-download'].includes(project.status)) {
    if (project.vectorPath && fs.existsSync(project.vectorPath)) {
      patch.status = 'vector-ready';
      patch.automationStep = 'Force stopped · vector preserved';
    } else {
      patch.status = 'vectorizer-recovery-needed';
      patch.automationStep = 'Force stopped · retry Vectorizer';
      patch.lastAutomationError = forceStopError('Vectorizer.ai', 'force-stop-vectorizer');
    }
  } else if (project.status === 'redbubble-preparing') {
    patch.status = project.redbubble?.preparedAt ? 'redbubble-review' : 'redbubble-recovery-needed';
    patch.automationStep = project.redbubble?.preparedAt ? 'Force stopped · Redbubble prep preserved' : 'Force stopped · retry Redbubble preparation';
    if (!project.redbubble?.preparedAt) patch.lastAutomationError = forceStopError('Redbubble', 'force-stop-redbubble');
  } else if (project.status === 'redbubble-publish-pending') {
    patch.status = 'redbubble-review';
    patch.automationStep = 'Force stopped · publish can be retried';
  }

  if (!Object.keys(patch).length) {
    try { projects.addActivity(projectId, { type: 'force-stop', label: 'Workflow force stopped by user; project state preserved' }); } catch {}
    return project;
  }

  const updated = projects.update(projectId, patch);
  try { projects.addActivity(projectId, { type: 'force-stop', label: 'Workflow force stopped by user; moved to safe retry state' }); } catch {}
  return updated;
}

async function killAutomationBrowsers() {
  const manager = new SessionManager();
  for (const serviceId of ['chatgpt', 'vectorizer', 'redbubble']) {
    await manager.killProfileEdgeProcesses(serviceId).catch(() => {});
  }
}

const previousStart = AutomationQueueController.prototype.start;
AutomationQueueController.prototype.start = function startAfterForceStop() {
  forceStoppingAutomation = false;
  return previousStart.call(this);
};

// Keep the existing queue behavior, but distinguish a deliberate Force Stop from
// a real automation failure so the current row stays retryable instead of being
// mislabeled as a broken job after its browser is terminated.
AutomationQueueController.prototype.runLoop = async function runLoopWithForceStopSupport() {
  while (!this.stopRequested) {
    const data = this.store.read();
    if (data.state === 'stopped') break;
    if (data.state === 'paused') { await wait(1500); continue; }

    await this.syncRows();
    const row = this.findRunnableRow();
    if (!row) { await wait(2500); continue; }

    try {
      await this.processRow(row);
    } catch (error) {
      if (forceStoppingAutomation) {
        const latest = this.store.read().rows.find((item) => item.id === row.id) || row;
        this.store.updateRow(row.id, {
          status: latest.projectId ? 'ready' : 'pending',
          step: 'Force stopped · ready to retry',
          lastError: null
        });
      } else {
        this.store.updateRow(row.id, {
          status: 'needs-attention',
          step: 'Error',
          lastError: error.message || String(error)
        });
      }
    }
    await wait(1200);
  }
};

function clearFailedRows() {
  const store = new AutomationQueueStore();
  const data = store.read();
  const before = data.rows.length;
  data.rows = data.rows.filter((row) => row.status !== 'needs-attention');
  const removed = before - data.rows.length;
  if (removed) store.write(data);
  return { ok: true, removed, snapshot: store.read() };
}

async function forceStopAutomation() {
  forceStoppingAutomation = true;
  const store = new AutomationQueueStore();
  const projects = new ProjectStore();
  const data = store.read();
  const runningRows = data.rows.filter((row) => row.status === 'running');

  data.state = 'stopped';
  for (const row of runningRows) {
    moveProjectToSafeRetry(projects, row.projectId);
    row.status = row.projectId ? 'ready' : 'pending';
    row.step = 'Force stopped · ready to retry';
    row.lastError = null;
    row.updatedAt = new Date().toISOString();
  }
  store.write(data);

  await killAutomationBrowsers();
  await wait(700);

  // A browser close can race the in-flight promise by a few hundred milliseconds.
  // Re-assert the retryable row state once more after the processes are gone.
  const after = store.read();
  let changed = false;
  for (const original of runningRows) {
    const row = after.rows.find((item) => item.id === original.id);
    if (!row || row.status === 'completed' || row.status === 'skipped') continue;
    row.status = row.projectId ? 'ready' : 'pending';
    row.step = 'Force stopped · ready to retry';
    row.lastError = null;
    row.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) store.write(after);
  return { ok: true, stoppedRows: runningRows.length, snapshot: store.read() };
}

async function forceStopWorkflow(projectId) {
  const queue = new AutomationQueueStore().read();
  if (queue.state === 'running' || queue.rows.some((row) => row.status === 'running')) {
    throw new Error('Automation is currently running. Use Force Stop Automation so the active queue row is preserved correctly.');
  }
  const projects = new ProjectStore();
  const updated = moveProjectToSafeRetry(projects, projectId);
  if (!updated) throw new Error('No active workflow project was found to force stop.');
  await killAutomationBrowsers();
  return { ok: true, project: projects.read(projectId) };
}

app.whenReady().then(() => {
  ipcMain.handle('automation:clear-failed', () => clearFailedRows());
  ipcMain.handle('automation:force-stop', () => forceStopAutomation());
  ipcMain.handle('workflow:force-stop', (_event, projectId) => forceStopWorkflow(projectId));
});

module.exports = {
  clearFailedRows,
  forceStopAutomation,
  forceStopWorkflow,
  moveProjectToSafeRetry
};
