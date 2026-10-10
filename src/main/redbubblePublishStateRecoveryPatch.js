const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousPrepare = RedbubbleController.prototype.prepare;
const previousPublish = RedbubbleController.prototype.publish;

async function publishEditorState(page) {
  const checkbox = page.locator([
    'input[type="checkbox"][name="rights_declaration"]',
    'input[type="checkbox"]#rightsDeclaration',
    'input[type="checkbox"][id*="rights" i]',
    'input[type="checkbox"][name*="rights" i]'
  ].join(', '));
  const agreementText = page.getByText(/i agree to the redbubble user agreement/i, { exact: false });
  const saveButton = page.getByRole('button', { name: /save work|publish|submit/i });

  return {
    checkbox: await checkbox.count().catch(() => 0),
    agreementText: await agreementText.count().catch(() => 0),
    saveButton: await saveButton.count().catch(() => 0),
    url: page.url()
  };
}

async function editorReadyForPublish(page) {
  let state = await publishEditorState(page);
  if ((state.checkbox || state.agreementText) && state.saveButton) return { ready: true, state };

  // Redbubble can lazy-mount the final declaration area near the bottom of the editor.
  // Scroll there once before deciding that the unsaved copied-work editor was lost.
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' })).catch(() => {});
  await wait(700);
  state = await publishEditorState(page);
  return { ready: Boolean((state.checkbox || state.agreementText) && state.saveButton), state };
}

RedbubbleController.prototype.prepare = async function prepareWithPublishStateSnapshot(projectId) {
  const result = await previousPrepare.call(this, projectId);
  if (!result?.ok) return result;

  try {
    const { page } = await this.sessions.ensureService('redbubble');
    const latest = this.projects.read(projectId);
    this.projects.update(projectId, {
      redbubble: {
        ...(latest.redbubble || {}),
        editorUrlAtReview: page.url(),
        editorStateCapturedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.warn('[ZeroPOD] Redbubble editor state snapshot skipped:', error?.message || error);
  }

  return { ...result, project: this.projects.read(projectId) };
};

RedbubbleController.prototype.publish = async function publishWithEditorRecovery(projectId) {
  let project = this.projects.read(projectId);

  if (project.status === 'redbubble-review') {
    const { page } = await this.sessions.ensureService('redbubble');
    const preflight = await editorReadyForPublish(page);

    if (!preflight.ready) {
      // The project says it is ready to publish, but Redbubble's unsaved duplicate
      // editor is no longer present. This happens after restarting ZeroPOD/Chrome or
      // when a prior batch attempt lost the service page. Rebuild ONLY the Redbubble
      // copy from the already exported PNG + saved metadata; do not rerun any earlier
      // pipeline stage.
      this.projects.addActivity(projectId, {
        type: 'automation',
        label: `Redbubble publish editor missing; rebuilding prepared copy (${preflight.state.url})`
      });

      await previousPrepare.call(this, projectId);
      project = this.projects.read(projectId);

      const recovered = await this.sessions.ensureService('redbubble');
      const recoveredState = await editorReadyForPublish(recovered.page);
      if (!recoveredState.ready) {
        throw new Error(`Redbubble publish editor could not be restored automatically. Current URL: ${recoveredState.state.url}`);
      }

      const latest = this.projects.read(projectId);
      this.projects.update(projectId, {
        redbubble: {
          ...(latest.redbubble || {}),
          recoveredForPublishAt: new Date().toISOString(),
          recoveredFromMissingEditor: true,
          editorUrlAtReview: recovered.page.url()
        }
      });
      this.projects.addActivity(projectId, { type: 'automation', label: 'Redbubble prepared copy rebuilt successfully; continuing automatic publish' });
    }
  }

  return previousPublish.call(this, projectId);
};

module.exports = {};
