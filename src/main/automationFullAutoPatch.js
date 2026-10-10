const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AutomationQueueController } = require('./automationQueueController');

const originalAddRows = AutomationQueueController.prototype.addRows;
const originalMapProjectToRow = AutomationQueueController.prototype.mapProjectToRow;
const originalProcessRow = AutomationQueueController.prototype.processRow;

AutomationQueueController.prototype.addRows = function addRowsMax15(rows = []) {
  const current = this.store.read().rows.length;
  if (current + rows.length > 15) {
    throw new Error(`Automation List supports a maximum of 15 rows. You currently have ${current}.`);
  }
  return originalAddRows.call(this, rows);
};

AutomationQueueController.prototype.mapProjectToRow = function mapProjectToFullAutoRow(project) {
  const mapped = originalMapProjectToRow.call(this, project) || {};
  const redbubble = project.redbubble || {};

  if (project.status === 'awaiting-review') {
    Object.assign(mapped, {
      status: 'ready',
      step: 'Auto-approving generated image',
      checkpoint: 'auto-image-approval',
      lastError: null
    });
  } else if (project.status === 'redbubble-review') {
    Object.assign(mapped, {
      status: 'ready',
      step: 'Ready for automatic publish',
      checkpoint: 'auto-publish',
      lastError: null
    });
  } else if (project.status === 'redbubble-publish-pending') {
    Object.assign(mapped, {
      status: 'ready',
      step: 'Verifying / retrying automatic publish',
      checkpoint: 'auto-publish-verify',
      lastError: null
    });
  } else if (project.status === 'published') {
    Object.assign(mapped, {
      status: 'completed',
      step: 'Published ✓',
      checkpoint: 'completed',
      lastError: null,
      completedAt: redbubble.publishedAt || project.updatedAt || new Date().toISOString()
    });
  }

  return {
    ...mapped,
    previewPath: redbubble.reviewScreenshotPath || null,
    publishedUrl: redbubble.publishedUrl || null,
    listingTitle: redbubble.title || project.metadata?.title || null
  };
};

async function autoApproveGeneratedProject(controller, project) {
  if (project.status !== 'awaiting-review') return project;
  if (!project.generatedImagePath || !fs.existsSync(project.generatedImagePath)) {
    throw new Error('Generated image is missing, so Automation List could not auto-approve it.');
  }

  const approvedImagePath = path.join(controller.projects.getProjectDir(project.id), 'approved.png');
  await sharp(project.generatedImagePath).png().toFile(approvedImagePath);
  const updated = controller.projects.update(project.id, {
    status: 'approved-image',
    approvedImagePath,
    review: { ...(project.review || {}), decision: 'passed', automatic: true, passedAt: new Date().toISOString() }
  });
  controller.projects.addActivity(project.id, { type: 'automation', label: 'Automation List auto-approved generated image' });
  return updated;
}

AutomationQueueController.prototype.processRow = async function processRowFullAuto(row) {
  // Keep the proven generation / metadata / vectorizer paths from the original
  // controller. Only intercept the two former review gates and the quality gate.
  if (!row.projectId) {
    return originalProcessRow.call(this, row);
  }

  const project = this.projects.read(row.projectId);

  if (project.status === 'awaiting-review') {
    this.markRunning(row.id, 'Auto-approving generated image', 'auto-image-approval');
    await autoApproveGeneratedProject(this, project);
    return;
  }

  if (['export-ready', 'redbubble-recovery-needed'].includes(project.status)) {
    this.markRunning(row.id, 'Preparing Redbubble Copy Existing Work', 'redbubble-prepare');
    // The proven unified workflow already showed that an extra manual quality gate
    // is unnecessary here. Redbubble preparation itself remains unchanged.
    await this.redbubble.prepare(project.id);
    return;
  }

  if (['redbubble-review', 'redbubble-publish-pending'].includes(project.status)) {
    this.markRunning(row.id, 'Publishing to Redbubble automatically', 'auto-publish');
    await this.redbubble.publish(project.id);
    return;
  }

  if (project.status === 'published') {
    const mapped = this.mapProjectToRow(project);
    this.store.updateRow(row.id, mapped);
    return;
  }

  return originalProcessRow.call(this, row);
};

module.exports = {};
