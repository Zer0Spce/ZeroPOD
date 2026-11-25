const { AutomationQueueController } = require('./automationQueueController');
const { feature: spreadshirt } = require('./spreadshirtAlphaIpc');

const previousAddRows = AutomationQueueController.prototype.addRows;
const previousUpdateRow = AutomationQueueController.prototype.updateRow;
const previousMapProjectToRow = AutomationQueueController.prototype.mapProjectToRow;
const previousProcessRow = AutomationQueueController.prototype.processRow;

function normalizeTargets(value = {}) {
  if (!value || typeof value !== 'object') return { redbubble: true, spreadshirt: false };
  const hasRedbubble = Object.prototype.hasOwnProperty.call(value, 'redbubble');
  const hasSpreadshirt = Object.prototype.hasOwnProperty.call(value, 'spreadshirt');
  return {
    redbubble: hasRedbubble ? Boolean(value.redbubble) : true,
    spreadshirt: hasSpreadshirt ? Boolean(value.spreadshirt) : false
  };
}

function targetLabel(targets) {
  if (targets.redbubble && targets.spreadshirt) return 'Redbubble + Spreadshirt';
  if (targets.spreadshirt) return 'Spreadshirt';
  if (targets.redbubble) return 'Redbubble';
  return 'No POD site';
}

function projectTargets(project) {
  return normalizeTargets(project?.automationTargets || {});
}

function redbubblePublished(project) {
  return Boolean(project?.redbubble?.publishedAt);
}

function spreadshirtPublished(project) {
  return Boolean(project?.spreadshirt?.publishedAt);
}

function selectedTargetsComplete(project, targets = projectTargets(project)) {
  const redbubbleDone = !targets.redbubble || redbubblePublished(project);
  const spreadshirtDone = !targets.spreadshirt || spreadshirtPublished(project);
  return redbubbleDone && spreadshirtDone;
}

function publishedUrls(project) {
  return {
    redbubble: project?.redbubble?.publishedUrl || null,
    spreadshirt: project?.spreadshirt?.publishedUrl || null
  };
}

function ensureTargetSelection(targets) {
  if (!targets.redbubble && !targets.spreadshirt) {
    throw new Error('Select Redbubble, Spreadshirt, or both before starting this Automation row.');
  }
}

function syncProjectTargets(controller, row, targets) {
  if (!row?.projectId) return null;
  let project;
  try { project = controller.projects.read(row.projectId); } catch { return null; }
  const current = projectTargets(project);
  if (current.redbubble === targets.redbubble && current.spreadshirt === targets.spreadshirt) return project;
  return controller.projects.update(project.id, { automationTargets: targets });
}

AutomationQueueController.prototype.addRows = function addRowsWithPodTargets(rows = []) {
  const beforeIds = new Set(this.store.read().rows.map((row) => row.id));
  previousAddRows.call(this, rows);
  const after = this.store.read();
  const added = after.rows.filter((row) => !beforeIds.has(row.id));
  added.forEach((row, index) => {
    this.store.updateRow(row.id, { targets: normalizeTargets(rows[index]?.targets) });
  });
  return this.snapshot();
};

AutomationQueueController.prototype.updateRow = function updateRowWithPodTargets(rowId, patch = {}) {
  const nextPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'targets')) {
    nextPatch.targets = normalizeTargets(nextPatch.targets);
  }
  const updated = previousUpdateRow.call(this, rowId, nextPatch);
  if (updated.projectId && nextPatch.targets) {
    syncProjectTargets(this, updated, nextPatch.targets);
  }
  return updated;
};

AutomationQueueController.prototype.mapProjectToRow = function mapProjectToMultiPodRow(project) {
  const base = previousMapProjectToRow.call(this, project) || {};
  const targets = projectTargets(project);
  const rbDone = !targets.redbubble || redbubblePublished(project);
  const ssDone = !targets.spreadshirt || spreadshirtPublished(project);

  if (!targets.redbubble && !targets.spreadshirt) {
    return {
      ...base,
      status: 'needs-attention',
      step: 'Select at least one POD site',
      checkpoint: 'pod-target-selection',
      lastError: 'Select Redbubble, Spreadshirt, or both for this Automation row.'
    };
  }

  if (rbDone && ssDone) {
    const urls = publishedUrls(project);
    return {
      ...base,
      status: 'completed',
      step: `Published ✓ · ${targetLabel(targets)}`,
      checkpoint: 'completed',
      lastError: null,
      completedAt: project.spreadshirt?.publishedAt || project.redbubble?.publishedAt || project.updatedAt || new Date().toISOString(),
      previewPath: project.redbubble?.reviewScreenshotPath || project.spreadshirt?.reviewScreenshotPath || base.previewPath || null,
      publishedUrl: urls.redbubble || urls.spreadshirt || base.publishedUrl || null,
      publishedUrls: urls,
      listingTitle: project.redbubble?.title || project.spreadshirt?.metadata?.title || project.metadata?.title || base.listingTitle || null,
      targets
    };
  }

  // Spreadshirt is intentionally completed before Redbubble when both are selected.
  // This prevents Redbubble's global `published` project status from prematurely
  // completing the queue row while the Spreadshirt destination is still pending.
  const exportReady = Boolean(project.finalPngPath && project.vectorPath && project.metadata);
  if (targets.spreadshirt && !ssDone && exportReady) {
    const spread = project.spreadshirt || {};
    let step = 'Preparing Spreadshirt automatically';
    let checkpoint = 'spreadshirt-prepare';
    if (spread.preparedAt || spread.uploadAcceptedAt) {
      step = 'Publishing / verifying Spreadshirt';
      checkpoint = 'spreadshirt-publish';
    } else if (!spread.pngPath) {
      step = 'Preparing Spreadshirt artwork';
      checkpoint = 'spreadshirt-export';
    } else if (!spread.metadata) {
      step = 'Preparing Spreadshirt metadata';
      checkpoint = 'spreadshirt-metadata';
    }
    return {
      ...base,
      status: 'ready',
      step,
      checkpoint,
      lastError: spread.lastError?.message || null,
      targets,
      publishedUrls: publishedUrls(project)
    };
  }

  return {
    ...base,
    targets,
    publishedUrls: publishedUrls(project)
  };
};

async function runSpreadshirtTarget(controller, row, project) {
  controller.markRunning(row.id, 'Preparing Spreadshirt automatically', 'spreadshirt-prepare');

  if (!project.spreadshirt?.alpha) {
    spreadshirt.markProject(project.id, { source: 'automation' });
    project = controller.projects.read(project.id);
  }

  if (!project.spreadshirt?.pngPath) {
    controller.markRunning(row.id, 'Preparing Spreadshirt artwork', 'spreadshirt-export');
    await spreadshirt.renderSpreadshirtPng(project.id);
    project = controller.projects.read(project.id);
  }

  if (!project.spreadshirt?.metadata) {
    controller.markRunning(row.id, 'Preparing Spreadshirt metadata', 'spreadshirt-metadata');
    spreadshirt.deriveMetadata(project.id);
    project = controller.projects.read(project.id);
  }

  if (!project.spreadshirt?.preparedAt) {
    controller.markRunning(row.id, 'Running Spreadshirt gate checks', 'spreadshirt-gates');
    const gate = await spreadshirt.check(project.id);
    if (!gate.ok) throw new Error(`Spreadshirt gate check failed: ${gate.errors.join(' ')}`);
    controller.markRunning(row.id, 'Uploading and preparing Spreadshirt', 'spreadshirt-prepare');
    await spreadshirt.prepare(project.id);
    project = controller.projects.read(project.id);
  }

  if (!project.spreadshirt?.publishedAt) {
    controller.markRunning(row.id, 'Publishing to Spreadshirt automatically', 'spreadshirt-publish');
    await spreadshirt.publish(project.id);
    project = controller.projects.read(project.id);
  }

  if (!project.spreadshirt?.publishedAt) {
    throw new Error('Spreadshirt did not reach a verified Published/In review result for this Automation row.');
  }

  return project;
}

AutomationQueueController.prototype.processRow = async function processRowWithPodTargets(row) {
  const targets = normalizeTargets(row.targets);
  ensureTargetSelection(targets);

  if (!row.projectId) {
    await previousProcessRow.call(this, row);
    const refreshed = this.store.read().rows.find((item) => item.id === row.id);
    if (refreshed?.projectId) {
      this.projects.update(refreshed.projectId, { automationTargets: targets });
      this.store.updateRow(row.id, { targets });
    }
    return;
  }

  let project = syncProjectTargets(this, row, targets) || this.projects.read(row.projectId);

  // Let the proven full-auto path own generation approval, metadata, vectorizing,
  // and the regular 4500×5400 export. POD destination routing begins only once
  // those shared assets exist.
  const sharedAssetsReady = Boolean(project.finalPngPath && project.vectorPath && project.metadata);
  if (!sharedAssetsReady) {
    return previousProcessRow.call(this, row);
  }

  if (targets.spreadshirt && !spreadshirtPublished(project)) {
    project = await runSpreadshirtTarget(this, row, project);
  }

  if (targets.redbubble && !redbubblePublished(project)) {
    return previousProcessRow.call(this, row);
  }

  const mapped = this.mapProjectToRow(this.projects.read(row.projectId));
  this.store.updateRow(row.id, mapped);
};

module.exports = {
  normalizeTargets,
  selectedTargetsComplete
};
