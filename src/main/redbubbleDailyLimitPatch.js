const { app, ipcMain } = require('electron');
const { RedbubbleController } = require('./redbubbleController');
const { ProjectStore } = require('./projectStore');

const DAILY_LIMIT = 30;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function getUsage(projects) {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const timestamps = projects.list({ includeArchived: true })
    .map((project) => Date.parse(project.redbubble?.publishedAt || ''))
    .filter((value) => Number.isFinite(value) && value > cutoff && value <= now)
    .sort((a, b) => a - b);
  return {
    limit: DAILY_LIMIT,
    count: timestamps.length,
    remaining: Math.max(0, DAILY_LIMIT - timestamps.length),
    blocked: timestamps.length >= DAILY_LIMIT,
    nextSlotAt: timestamps.length ? new Date(timestamps[0] + WINDOW_MS).toISOString() : null,
    windowHours: 24
  };
}

RedbubbleController.prototype.getDailyUploadUsage = function getDailyUploadUsage() { return getUsage(this.projects); };

const originalPublish = RedbubbleController.prototype.publish;
RedbubbleController.prototype.publish = async function publishWithDailyLimit(projectId) {
  const project = this.projects.read(projectId);
  const usage = this.getDailyUploadUsage();
  if (project.status !== 'published' && usage.blocked) {
    const next = usage.nextSlotAt ? new Date(usage.nextSlotAt).toLocaleString() : 'later';
    const message = `ZeroPOD has tracked ${DAILY_LIMIT} successful Redbubble publishes in the last 24 hours. The next locally tracked slot becomes available around ${next}.`;
    this.projects.update(projectId, {
      lastAutomationError: {
        service: 'Redbubble', step: 'daily-upload-limit', message, at: new Date().toISOString(),
        recovery: 'Wait for a tracked slot to reopen. If Redbubble itself shows an upload-limit warning, Redbubble is the source of truth and publishing should resume only after that warning disappears.'
      },
      redbubble: { ...(project.redbubble || {}), uploadLimitBlockedAt: new Date().toISOString(), nextTrackedSlotAt: usage.nextSlotAt }
    });
    const error = new Error(message);
    error.code = 'REDBUBBLE_DAILY_LIMIT';
    error.limit = usage;
    throw error;
  }
  return originalPublish.call(this, projectId);
};

app.whenReady().then(() => {
  const projects = new ProjectStore();
  ipcMain.handle('redbubble:daily-usage', () => getUsage(projects));
});

module.exports = { DAILY_LIMIT, WINDOW_MS, getUsage };
