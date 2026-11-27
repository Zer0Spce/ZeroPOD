const { feature } = require('./spreadshirtAlphaIpc');
const {
  designIdFromEditorUrl,
  waitForEditorPublishStatus,
  clickSaveAndPublishTrusted
} = require('./spreadshirtStrictPublishVerifyPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

async function findVisibleSaveAndPublish(page) {
  for (const frame of page.frames()) {
    const button = frame.getByRole('button', { name: /^Save and publish$/i }).first();
    try {
      if (!(await button.count()) || !(await button.isVisible()) || await button.isDisabled()) continue;
      return { frame, button };
    } catch {}
  }
  return null;
}

function removePublishLedgerEntry(projectId) {
  try {
    const ledger = feature.readLedger();
    const next = ledger.filter((entry) => entry.projectId !== projectId);
    if (next.length !== ledger.length) feature.writeLedger(next);
  } catch {}
}

function provisionalPublishedAfterClick(projectId, page, expectedId, status = null) {
  const now = new Date().toISOString();
  const current = feature.projects.read(projectId);
  const canonicalUrl = expectedId
    ? `https://partner.spreadshirt.com/mp/designs/${encodeURIComponent(expectedId)}`
    : (current.spreadshirt?.editorUrl || page.url());
  removePublishLedgerEntry(projectId);
  feature.recordPublish(projectId, canonicalUrl);
  const normalized = String(status || '').trim().toLowerCase();
  return feature.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      status: 'published',
      publishedAt: now,
      publishedUrl: canonicalUrl,
      editorUrl: canonicalUrl,
      uploadDesignId: expectedId || current.spreadshirt?.uploadDesignId || null,
      reviewState: normalized === 'in review' ? 'under-review' : null,
      publishVerification: 'save-and-publish-click-observed-pending-grid-proof',
      publishVerificationDesignId: expectedId || null,
      publishVerificationStatus: status || null,
      publishActionClickedAt: now,
      lastError: null
    }
  });
}

const previousPublish = feature.publish.bind(feature);
feature.publish = async function publishRequiringPhysicalSaveAndPublish(projectId) {
  const project = this.projects.read(projectId);
  const expectedId = project.spreadshirt?.uploadDesignId
    || designIdFromEditorUrl(project.spreadshirt?.editorUrl || project.spreadshirt?.publishedUrl || '');
  const { page } = await this.sessions.ensureService('spreadshirt');

  const currentId = designIdFromEditorUrl(page.url());
  if (expectedId && currentId && currentId !== expectedId) {
    throw new Error(`Spreadshirt publish identity mismatch before Save and publish: active editor ${currentId}, expected uploaded design ${expectedId}. ZeroPOD did not click or publish the wrong design.`);
  }

  const visibleAction = await findVisibleSaveAndPublish(page);
  if (!visibleAction) {
    // If there is no actionable button, fall back to the existing strict verifier.
    // This preserves safe resume behavior for designs that were genuinely submitted already.
    return previousPublish(projectId);
  }

  activity(projectId, `Visible “Save and publish” is still actionable for design ${expectedId || currentId || 'unknown'}. Existing In review/Published text will NOT be accepted as success until this button is clicked.`);

  const clickToken = `zeropod-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await visibleAction.button.evaluate((button, token) => {
      window.__zeroPodSavePublishClickToken = null;
      button.addEventListener('click', () => {
        window.__zeroPodSavePublishClickToken = token;
      }, { once: true, capture: true });
    }, clickToken);
  } catch {}

  const action = await clickSaveAndPublishTrusted(page, 12000);
  if (!action.ok) {
    const labels = action.visibleActions?.length ? ` Visible actions: ${action.visibleActions.join(' | ')}` : '';
    throw new Error(`Spreadshirt “Save and publish” was visible but ZeroPOD could not click it.${labels}`);
  }

  let clickObserved = false;
  try {
    clickObserved = await visibleAction.frame.evaluate((token) => window.__zeroPodSavePublishClickToken === token, clickToken);
  } catch {
    // A navigation/frame replacement immediately after the trusted click is also
    // acceptable evidence that the physical action was dispatched.
    clickObserved = true;
  }
  if (!clickObserved) {
    throw new Error('Spreadshirt “Save and publish” locator returned from click, but ZeroPOD did not observe the button click event. Publish was not marked successful.');
  }

  activity(projectId, 'Physically clicked Spreadshirt “Save and publish”. Waiting for the exact design status…');
  let editorStatus = null;
  if (expectedId) {
    const started = Date.now();
    while (Date.now() - started < 7000) {
      const found = await waitForEditorPublishStatus(page, expectedId, 900).catch(() => null);
      if (found?.status) {
        editorStatus = found.status;
        break;
      }
      await wait(250);
    }
  }

  const updated = provisionalPublishedAfterClick(projectId, page, expectedId || currentId, editorStatus);
  activity(projectId, `Save and publish click was observed${editorStatus ? `; editor currently shows ${editorStatus}` : ''}. Awaiting independent exact-card proof before final success.`);
  return {
    ok: true,
    project: updated,
    publishedAt: updated.spreadshirt?.publishedAt || new Date().toISOString(),
    url: updated.spreadshirt?.publishedUrl || page.url(),
    usage: feature.usage(),
    underReview: String(editorStatus || '').trim().toLowerCase() === 'in review',
    publishActionClicked: true
  };
};

module.exports = { findVisibleSaveAndPublish };
