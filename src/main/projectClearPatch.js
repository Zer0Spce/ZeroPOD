const { app, ipcMain } = require('electron');
const fs = require('fs');
const { ProjectStore } = require('./projectStore');
const { AutomationQueueStore } = require('./automationQueueStore');

const projects = new ProjectStore();
const automationStore = new AutomationQueueStore();
const CONFIRMATION = 'CLEAR PROJECTS';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const BUSY_STATUSES = new Set([
  'generating',
  'regenerating',
  'metadata-generating',
  'vectorizing',
  'vectorizer-manual-download',
  'redbubble-preparing',
  'redbubble-publish-pending'
]);

function projectStats(allProjects) {
  const cutoff = Date.now() - WINDOW_MS;
  let publishedRecords = 0;
  let recentPublishedRecords = 0;

  for (const project of allProjects) {
    const publishedAt = Date.parse(project.redbubble?.publishedAt || '');
    if (!Number.isFinite(publishedAt)) continue;
    publishedRecords += 1;
    if (publishedAt > cutoff && publishedAt <= Date.now()) recentPublishedRecords += 1;
  }

  return { publishedRecords, recentPublishedRecords };
}

function resetLinkedAutomationRows() {
  const data = automationStore.read();
  let resetRows = 0;
  let detachedCompletedRows = 0;

  data.rows = (data.rows || []).map((row) => {
    if (!row.projectId) return row;

    if (['completed', 'skipped'].includes(row.status)) {
      detachedCompletedRows += 1;
      return {
        ...row,
        projectId: null,
        checkpoint: null,
        updatedAt: new Date().toISOString()
      };
    }

    const completeInput = Boolean(String(row.referenceImage || '').trim() && String(row.amazonLink || '').trim());
    resetRows += 1;
    return {
      ...row,
      projectId: null,
      status: completeInput ? 'pending' : 'draft',
      step: completeInput ? 'Waiting' : 'Complete image + Amazon link',
      checkpoint: completeInput ? 'input-ready' : 'draft',
      lastError: null,
      recoveredAt: null,
      updatedAt: new Date().toISOString()
    };
  });

  if (resetRows || detachedCompletedRows) automationStore.write(data);
  return { resetRows, detachedCompletedRows };
}

function clearProjects() {
  const allProjects = projects.list({ includeArchived: true });
  const stats = projectStats(allProjects);
  const queueImpact = resetLinkedAutomationRows();
  const root = projects.getRoot();

  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  return {
    ok: true,
    deleted: allProjects.length,
    publishedRecordsRemoved: stats.publishedRecords,
    recentPublishedRecordsRemoved: stats.recentPublishedRecords,
    automationRowsReset: queueImpact.resetRows,
    completedRowsDetached: queueImpact.detachedCompletedRows
  };
}

app.whenReady().then(() => {
  ipcMain.handle('projects:clear-all', (_event, payload = {}) => {
    if (payload.confirmation !== CONFIRMATION) {
      throw new Error('Clear Projects confirmation was not accepted. No project data was deleted.');
    }

    const queue = automationStore.read();
    const rows = Array.isArray(queue.rows) ? queue.rows : [];
    if (queue.state === 'running' || rows.some((row) => row.status === 'running')) {
      throw new Error('Pause or stop Automation and wait for the current row to finish before clearing projects. No project data was deleted.');
    }

    const allProjects = projects.list({ includeArchived: true });
    const busyProjects = allProjects.filter((project) => BUSY_STATUSES.has(project.status));
    if (busyProjects.length) {
      throw new Error(`Cannot clear projects while ${busyProjects.length} project${busyProjects.length === 1 ? ' is' : 's are'} actively processing. Wait for the current operation to finish first.`);
    }

    return clearProjects();
  });
});

module.exports = { CONFIRMATION, clearProjects, resetLinkedAutomationRows };
