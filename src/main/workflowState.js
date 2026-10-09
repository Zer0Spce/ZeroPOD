const STAGES = {
  created: { order: 0, next: 'Generate design', view: 'review' },
  generating: { order: 1, next: 'Wait for ChatGPT image', view: 'review' },
  regenerating: { order: 1, next: 'Wait for regenerated image', view: 'review' },
  'chatgpt-recovery-needed': { order: 1, next: 'Retry ChatGPT generation/download', view: 'review' },
  'awaiting-review': { order: 2, next: 'Review image and Pass or Reject', view: 'review' },
  'approved-image': { order: 3, next: 'Generate POD WINNER metadata', view: 'workflow' },
  'metadata-recovery-needed': { order: 3, next: 'Retry POD WINNER metadata', view: 'workflow' },
  'metadata-ready': { order: 4, next: 'Vectorize approved design', view: 'workflow' },
  vectorizing: { order: 5, next: 'Wait for Vectorizer.ai', view: 'workflow' },
  'vectorizer-recovery-needed': { order: 5, next: 'Retry Vectorizer.ai', view: 'workflow' },
  'vector-ready': { order: 6, next: 'Export 4500×5400 PNG', view: 'workflow' },
  'export-ready': { order: 7, next: 'Prepare Redbubble copy', view: 'upload' },
  'redbubble-preparing': { order: 8, next: 'Wait for Redbubble preparation', view: 'upload' },
  'redbubble-recovery-needed': { order: 8, next: 'Retry Redbubble preparation', view: 'upload' },
  'redbubble-review': { order: 9, next: 'Final review then Publish / Save Work', view: 'upload' },
  published: { order: 10, next: 'Complete', view: 'upload' }
};

function describe(project) {
  const status = project?.status || 'created';
  const stage = STAGES[status] || { order: -1, next: 'Open project and review status', view: 'projects' };
  return { status, ...stage };
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
  assertStatus(project, ['redbubble-review'], 'Publish / Save Work');
}

module.exports = {
  describe,
  assertReviewable,
  assertMetadata,
  assertVectorize,
  assertExport,
  assertRedbubblePrepare,
  assertPublish
};
