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

function clearProjects() {
  const allProjects = projects.list({ includeArchived: true });
  const stats = projectStats(allProjects);
  const root = projects.getRoot();

  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  return {
    ok: true,
    deleted: allProjects.length,
    publishedRecordsRemoved: stats.publishedRecords,
    recentPublishedRecordsRemoved: stats.recentPublishedRecords
  };
}

app.whenReady().then(() => {
  ipcMain.handle('projects:clear-all', (_event, payload = {}) => {
    if (payload.confirmation !== CONFIRMATION) {
      throw new Error('Clear Projects confirmation was not accepted. No project data was deleted.');
    }

    const queue = automationStore.read();
    const rows = Array.isArray(queue.rows) ? queue.rows : [];
    const liveRows = rows.filter((row) => row.projectId && !['completed', 'skipped'].includes(row.status));
    if (queue.state === 'running' || rows.some((row) => row.status === 'running')) {
      throw new Error('Pause or stop the Automation List before clearing projects. No project data was deleted.');
    }
    if (liveRows.length) {
      throw new Error(`Cannot clear projects while ${liveRows.length} active Automation List row${liveRows.length === 1 ? '' : 's'} still reference project data. Complete, skip, or remove those rows first.`);
    }

    const allProjects = projects.list({ includeArchived: true });
    const busyProjects = allProjects.filter((project) => BUSY_STATUSES.has(project.status));
    if (busyProjects.length) {
      throw new Error(`Cannot clear projects while ${busyProjects.length} project${busyProjects.length === 1 ? ' is' : 's are'} actively processing. Wait for the current operation to finish first.`);
    }

    return clearProjects();
  });
});

module.exports = { CONFIRMATION, clearProjects };
