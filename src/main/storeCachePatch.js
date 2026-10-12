const fs = require('fs');
const { ProjectStore } = require('./projectStore');
const { AutomationQueueStore } = require('./automationQueueStore');

const projectCache = new Map();
const queueCache = new Map();

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function signature(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

const originalProjectRead = ProjectStore.prototype.read;
ProjectStore.prototype.read = function readCached(projectId) {
  const file = this.getProjectFile(projectId);
  const sig = signature(file);
  const cached = sig && projectCache.get(file);
  if (cached?.signature === sig) return clone(cached.value);

  const value = originalProjectRead.call(this, projectId);
  const after = signature(file);
  if (after) projectCache.set(file, { signature: after, value: clone(value) });
  return value;
};

const originalProjectWrite = ProjectStore.prototype.write;
ProjectStore.prototype.write = function writeAndRefreshCache(project) {
  const value = originalProjectWrite.call(this, project);
  const file = this.getProjectFile(project.id);
  const sig = signature(file);
  if (sig) projectCache.set(file, { signature: sig, value: clone(value) });
  return value;
};

const originalProjectDelete = ProjectStore.prototype.delete;
ProjectStore.prototype.delete = function deleteAndClearCache(projectId) {
  const file = this.getProjectFile(projectId);
  const result = originalProjectDelete.call(this, projectId);
  projectCache.delete(file);
  return result;
};

const originalQueueRead = AutomationQueueStore.prototype.read;
AutomationQueueStore.prototype.read = function readQueueCached() {
  const file = this.getFile();
  const sig = signature(file);
  const cached = sig && queueCache.get(file);
  if (cached?.signature === sig) return clone(cached.value);

  const value = originalQueueRead.call(this);
  const after = signature(file);
  if (after) queueCache.set(file, { signature: after, value: clone(value) });
  return value;
};

const originalQueueWrite = AutomationQueueStore.prototype.write;
AutomationQueueStore.prototype.write = function writeQueueAndRefreshCache(data) {
  const value = originalQueueWrite.call(this, data);
  const file = this.getFile();
  const sig = signature(file);
  if (sig) queueCache.set(file, { signature: sig, value: clone(value) });
  return value;
};

module.exports = { projectCache, queueCache };
