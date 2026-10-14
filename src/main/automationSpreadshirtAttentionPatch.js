const { AutomationQueueController } = require('./automationQueueController');

const previousProcessRow = AutomationQueueController.prototype.processRow;
const previousMapProjectToRow = AutomationQueueController.prototype.mapProjectToRow;
const previousRetry = AutomationQueueController.prototype.retry;
const POST_UPLOAD_CARD_ERROR = /returned to Designs after Upload Status|could not verify a genuinely new design card|new design card.*not visible/i;

function spreadshirtSelected(row, project) {
  const targets = row?.targets || project?.automationTargets || {};
  return Boolean(targets.spreadshirt);
}

function isSpreadshirtPending(project) {
  return Boolean(project?.spreadshirt?.alpha) && !project?.spreadshirt?.publishedAt;
}

AutomationQueueController.prototype.processRow = async function processRowWithSpreadshirtAttention(row) {
  try {
    return await previousProcessRow.call(this, row);
  } catch (error) {
    if (row?.projectId) {
      try {
        const project = this.projects.read(row.projectId);
        if (spreadshirtSelected(row, project) && isSpreadshirtPending(project)) {
          const message = error?.message || String(error);
          this.projects.update(project.id, {
            spreadshirt: {
              ...(project.spreadshirt || {}),
              lastError: {
                message,
                step: row.checkpoint || 'spreadshirt-automation',
                at: new Date().toISOString()
              }
            }
          });
        }
      } catch {}
    }
    throw error;
  }
};

AutomationQueueController.prototype.mapProjectToRow = function mapProjectWithSpreadshirtAttention(project) {
  const mapped = previousMapProjectToRow.call(this, project);
  const targets = project?.automationTargets || {};
  const spreadError = project?.spreadshirt?.lastError;

  if (targets.spreadshirt && !project?.spreadshirt?.publishedAt && spreadError?.message) {
    return {
      ...(mapped || {}),
      status: 'needs-attention',
      step: 'Spreadshirt needs attention',
      checkpoint: 'spreadshirt-attention',
      lastError: spreadError.message
    };
  }

  return mapped;
};

AutomationQueueController.prototype.retry = function retrySpreadshirtAttention(rowId) {
  const row = this.store.read().rows.find((item) => item.id === rowId);
  if (row?.projectId) {
    try {
      const project = this.projects.read(row.projectId);
      if (spreadshirtSelected(row, project) && project?.spreadshirt?.lastError) {
        const previousError = project.spreadshirt.lastError;
        const needsUploadRecovery = POST_UPLOAD_CARD_ERROR.test(String(previousError?.message || ''));
        this.projects.update(project.id, {
          spreadshirt: {
            ...(project.spreadshirt || {}),
            lastError: null,
            automationUploadRecoveryError: needsUploadRecovery ? previousError : null,
            retryRequestedAt: new Date().toISOString()
          }
        });
      }
    } catch {}
  }
  return previousRetry.call(this, rowId);
};

module.exports = { spreadshirtSelected, POST_UPLOAD_CARD_ERROR };
