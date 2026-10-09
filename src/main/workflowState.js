const STAGES = {
  created: { order: 0, label: 'Created', next: 'Generate design', view: 'review', queue: 'active' },
  generating: { order: 1, label: 'Generating', next: 'Wait for ChatGPT image', view: 'review', queue: 'active' },
  regenerating: { order: 1, label: 'Regenerating', next: 'Wait for regenerated image', view: 'review', queue: 'active' },
  'chatgpt-recovery-needed': { order: 1, label: 'ChatGPT Needs Attention', next: 'Retry ChatGPT generation/download', view: 'review', queue: 'attention' },
  'awaiting-review': { order: 2, label: 'Image Review', next: 'Review image and Pass or Reject', view: 'review', queue: 'review' },
  'approved-image': { order: 3, label: 'Image Approved', next: 'Generate POD WINNER metadata', view: 'workflow', queue: 'active' },
  'metadata-generating': { order: 3, label: 'Generating Metadata', next: 'Wait for POD WINNER metadata', view: 'workflow', queue: 'active' },
  'metadata-recovery-needed': { order: 3, label: 'Metadata Needs Attention', next: 'Retry POD WINNER metadata', view: 'workflow', queue: 'attention' },
  'metadata-ready': { order: 4, label: 'Metadata Ready', next: 'Vectorize approved design', view: 'workflow', queue: 'active' },
  vectorizing: { order: 5, label: 'Vectorizing', next: 'Wait for Vectorizer.ai', view: 'workflow', queue: 'active' },
  'vectorizer-manual-download': { order: 5, label: 'Vectorizer Download', next: 'Complete or retry SVG download', view: 'workflow', queue: 'active' },
  'vectorizer-recovery-needed': { order: 5, label: 'Vectorizer Needs Attention', next: 'Retry Vectorizer.ai', view: 'workflow', queue: 'attention' },
  'vector-ready': { order: 6, label: 'Vector Ready', next: 'Export 4500×5400 PNG', view: 'workflow', queue: 'active' },
  'export-ready': { order: 7, label: 'Export Ready', next: 'Prepare Redbubble copy', view: 'upload', queue: 'upload' },
  'redbubble-preparing': { order: 8, label: 'Preparing Redbubble', next: 'Wait for Redbubble preparation', view: 'upload', queue: 'upload' },
  'redbubble-recovery-needed': { order: 8, label: 'Redbubble Needs Attention', next: 'Retry Redbubble preparation', view: 'upload', queue: 'attention' },
  'redbubble-review': { order: 9, label: 'Final Review', next: 'Final review then Publish / Save Work', view: 'upload', queue: 'review' },
  'redbubble-publish-pending': { order: 9, label: 'Publish Pending Verification', next: 'Verify Redbubble publish result', view: 'upload', queue: 'attention' },
  published: { order: 10, label: 'Published', next: 'Complete', view: 'upload', queue: 'completed' }
};

const MAX_ORDER = 10;

function describe(project) {
  const status = project?.status || 'created';
  const stage = STAGES[status] || { order: -1, label: 'Unknown', next: 'Open project and review status', view: 'projects', queue: 'attention' };
  const progress = stage.order < 0 ? 0 : Math.max(0, Math.min(100, Math.round((stage.order / MAX_ORDER) * 100)));
  return { status, ...stage, progress };
}

function assertStatus(project, allowed, actionLabel) {
  if (!allowed.includes(project.status)) {
    const current = describe(project);
    throw new Error(`${actionLabel} is not available while status is "${project.status}". Next action: ${current.next}.`);
  }
}

function assertReviewable(project) {
  assertStatus(project, ['awaiting-review'], 'Review action');
  if (!project.generatedImagePath) throw new Error('Generated image is missing. Retry ChatGPT generation/download first.');
}

function assertMetadata(project) {
  assertStatus(project, ['approved-image', 'metadata-recovery-needed', 'metadata-ready'], 'Metadata generation');
  if (project.review?.decision !== 'passed') throw new Error('Image must pass review before metadata generation.');
}

function assertVectorize(project) {
  assertStatus(project, ['metadata-ready', 'vectorizer-recovery-needed'], 'Vectorization');
  if (!project.metadata) throw new Error('Generate POD WINNER metadata before vectorization.');
}

function assertExport(project) {
  assertStatus(project, ['vector-ready'], 'PNG export');
  if (!project.vectorPath) throw new Error('Vector file is missing. Complete Vectorizer.ai first.');
}

function assertRedbubblePrepare(project) {
  assertStatus(project, ['export-ready', 'redbubble-recovery-needed'], 'Redbubble preparation');
  if (!project.finalPngPath || !project.metadata) throw new Error('Final PNG and POD WINNER metadata are required before Redbubble preparation.');
}

function assertPublish(project) {
  assertStatus(project, ['redbubble-review', 'redbubble-publish-pending'], 'Publish / Verify Redbubble Work');
}

module.exports = { describe, assertReviewable, assertMetadata, assertVectorize, assertExport, assertRedbubblePrepare, assertPublish };
