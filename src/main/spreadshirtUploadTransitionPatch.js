const videoFlow = require('./spreadshirtVideoFlowPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UPLOAD_ERROR_PATTERN = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error occured|Unfortunately, an error occurred/i;
const HUMAN_CHECK_PATTERN = /captcha|verify you are human|are you human|cloudflare/i;
const MARKETPLACE_DESIGNS_INDEX_RE = /\/mp\/designs\/?(?:[?#].*)?$/i;
const MARKETPLACE_DESIGN_EDITOR_RE = /\/mp\/designs\/[^/?#]+\/?(?:[?#].*)?$/i;

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
}

async function uploadDialogVisible(page) {
  const dialog = page.getByRole('dialog').filter({ hasText: /Upload (?:design|status)/i }).first();
  try {
    return Boolean(await dialog.count()) && await dialog.isVisible();
  } catch {
    return false;
  }
}

function compactDiagnosticText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function waitForUploadResultReliable(page, timeoutMs = 60000) {
  const started = Date.now();
  let sawUploadStatus = false;
  let lastText = '';
  let lastUrl = page.url();

  while (Date.now() - started < timeoutMs) {
    const text = await bodyText(page);
    const url = page.url();
    lastText = text;
    lastUrl = url;

    if (HUMAN_CHECK_PATTERN.test(text)) {
      throw new Error('Spreadshirt is showing a human-verification challenge. Complete it manually, then retry.');
    }
    if (UPLOAD_ERROR_PATTERN.test(text)) {
      throw new Error('Spreadshirt showed “Ooops! Snap. It didn’t work.” during the upload.');
    }

    if (/Upload status/i.test(text)) sawUploadStatus = true;
    if (/Upload successful/i.test(text)) {
      return { ok: true, sawUploadStatus, reason: 'upload-success-text', url };
    }

    // Spreadshirt does not always leave the success banner on-screen. A direct
    // transition into the newly-created editor is a stronger success signal than
    // waiting for literal banner text that may already have disappeared.
    if (MARKETPLACE_DESIGN_EDITOR_RE.test(url)) {
      return { ok: true, sawUploadStatus, reason: 'direct-design-editor', url };
    }
    if (/Design products/i.test(text) && /Metadata/i.test(text)) {
      return { ok: true, sawUploadStatus, reason: 'design-editor-ready', url };
    }

    // Another current Spreadshirt path closes Upload Status and returns to the
    // Marketplace Designs index while the new card is being added. Fresh-card
    // identity verification runs immediately after this and still prevents ZeroPOD
    // from opening an older design by mistake.
    const dialogVisible = await uploadDialogVisible(page);
    if (sawUploadStatus && MARKETPLACE_DESIGNS_INDEX_RE.test(url) && !dialogVisible && !/Upload design/i.test(text)) {
      return { ok: true, sawUploadStatus, reason: 'designs-index-after-upload-status', url };
    }

    await wait(350);
  }

  const diagnostics = compactDiagnosticText(lastText);
  throw new Error(
    `Spreadshirt upload did not reach a verified completion state within ${Math.round(timeoutMs / 1000)} seconds. ` +
    `Current page: ${lastUrl || 'unknown'}. Saw Upload Status: ${sawUploadStatus ? 'yes' : 'no'}. ` +
    `Page text: ${diagnostics || 'unavailable'}`
  );
}

videoFlow.waitForUploadResult = waitForUploadResultReliable;

module.exports = {
  waitForUploadResultReliable,
  MARKETPLACE_DESIGNS_INDEX_RE,
  MARKETPLACE_DESIGN_EDITOR_RE
};
