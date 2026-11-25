const { feature } = require('./spreadshirtAlphaIpc');
const { designIdFromEditorUrl } = require('./spreadshirtStrictPublishVerifyPatch');
const { waitForDesignEditor } = require('./spreadshirtVideoFlowPatch');

function norm(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sameText(a, b) {
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function removePublishLedgerEntry(projectId) {
  try {
    const ledger = feature.readLedger();
    const next = ledger.filter((entry) => entry.projectId !== projectId);
    if (next.length !== ledger.length) feature.writeLedger(next);
  } catch {}
}

async function visibleEditorName(page) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.getByLabel(/^Name$/i).first(),
      frame.getByLabel(/design name/i).first(),
      frame.locator('input[name*="name" i]').first(),
      frame.locator('input[name*="title" i]').first()
    ];
    for (const candidate of candidates) {
      try {
        if (!(await candidate.count()) || !(await candidate.isVisible())) continue;
        const value = await candidate.inputValue().catch(() => '');
        if (norm(value)) return norm(value);
      } catch {}
    }
  }
  return '';
}

function resetFalsePublishedIdentity(projectId, nextSpreadshirt) {
  const current = feature.projects.read(projectId);
  removePublishLedgerEntry(projectId);
  return feature.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      ...nextSpreadshirt,
      status: 'review',
      publishedAt: null,
      publishedUrl: null,
      reviewState: null,
      publishVerification: 'identity-corrected-before-publish',
      falsePublishRevertedAt: new Date().toISOString(),
      lastError: null
    }
  });
}

const previousPublish = feature.publish.bind(feature);
feature.publish = async function publishWithCanonicalSpreadshirtIdentity(projectId) {
  let project = this.projects.read(projectId);
  const { page } = await this.sessions.ensureService('spreadshirt');

  const storedUploadId = project.spreadshirt?.uploadDesignId || null;
  const storedEditorId = designIdFromEditorUrl(project.spreadshirt?.editorUrl || '');
  const currentId = designIdFromEditorUrl(page.url());
  const preUploadIds = new Set((project.spreadshirt?.preUploadDesignIds || []).map(String));
  const expectedTitle = project.spreadshirt?.metadata?.title || '';
  const currentTitle = currentId ? await visibleEditorName(page).catch(() => '') : '';

  let canonicalId = storedUploadId || storedEditorId || null;

  // If the live editor is clearly this project's freshly uploaded design, prefer
  // that identity over a stale stored editor URL from an older design. This is
  // deliberately conservative: exact title match + not present before upload.
  if (currentId
      && currentId !== canonicalId
      && expectedTitle
      && currentTitle
      && sameText(currentTitle, expectedTitle)
      && !preUploadIds.has(currentId)) {
    canonicalId = currentId;
    const canonicalUrl = `https://partner.spreadshirt.com/mp/designs/${encodeURIComponent(currentId)}`;
    project = resetFalsePublishedIdentity(projectId, {
      uploadDesignId: currentId,
      editorUrl: canonicalUrl
    });
    activity(projectId, `Corrected stale Spreadshirt design identity to the live matching editor ${currentId}. Previous stored design ID was not used for publish verification.`);
  }

  if (!canonicalId) {
    throw new Error('Spreadshirt publish has no verified uploaded design ID. ZeroPOD will not publish or verify an unidentified design.');
  }

  const canonicalUrl = `https://partner.spreadshirt.com/mp/designs/${encodeURIComponent(canonicalId)}`;
  if (designIdFromEditorUrl(project.spreadshirt?.editorUrl || '') !== canonicalId
      || (project.spreadshirt?.publishedUrl && designIdFromEditorUrl(project.spreadshirt.publishedUrl) !== canonicalId)) {
    project = resetFalsePublishedIdentity(projectId, {
      uploadDesignId: canonicalId,
      editorUrl: canonicalUrl
    });
    activity(projectId, `Spreadshirt project identity normalized to exact uploaded design ${canonicalId}.`);
  }

  if (designIdFromEditorUrl(page.url()) !== canonicalId) {
    activity(projectId, `Opening exact uploaded Spreadshirt design ${canonicalId} before metadata validation and Save and publish…`);
    await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForDesignEditor(page, 20000);
  }

  const activeId = designIdFromEditorUrl(page.url());
  if (activeId !== canonicalId) {
    throw new Error(`Spreadshirt identity guard blocked publishing: active editor ${activeId || 'unknown'}, expected exact uploaded design ${canonicalId}. No other design was published.`);
  }

  const liveTitle = await visibleEditorName(page).catch(() => '');
  if (expectedTitle && liveTitle && !sameText(liveTitle, expectedTitle)) {
    throw new Error(`Spreadshirt identity guard blocked publishing design ${canonicalId}: editor name “${liveTitle}” does not match this project “${expectedTitle}”.`);
  }

  const current = this.projects.read(projectId);
  if (designIdFromEditorUrl(current.spreadshirt?.editorUrl || '') !== canonicalId) {
    this.projects.update(projectId, {
      spreadshirt: {
        ...(current.spreadshirt || {}),
        uploadDesignId: canonicalId,
        editorUrl: canonicalUrl,
        lastError: null
      }
    });
  }

  activity(projectId, `Exact Spreadshirt publish identity locked to ${canonicalId}.`);
  return previousPublish(projectId);
};

module.exports = { visibleEditorName };
