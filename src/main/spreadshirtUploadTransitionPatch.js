const videoFlow = require('./spreadshirtVideoFlowPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UPLOAD_ERROR_PATTERN = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error occured|Unfortunately, an error occurred/i;
const UPLOAD_LIMIT_PATTERN = /upload\s+limit|daily\s+(?:upload|design)|maximum\s+(?:number\s+of\s+)?(?:uploads?|designs?)|too\s+many\s+(?:uploads?|designs?)|exceeded[^\n]{0,80}(?:uploads?|designs?)|try\s+again\s+tomorrow/i;
const UPLOAD_REJECTION_PATTERN = /upload\s+failed|could(?:n[’']?t| not)\s+upload|file\s+(?:was\s+)?not\s+uploaded|unsupported\s+(?:file|format)|invalid\s+(?:file|format)|file\s+too\s+(?:large|small)/i;
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
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 700);
}

async function waitForUploadResultReliable(page, timeoutMs = 60000) {
  const started = Date.now();
  let sawUploadStatus = false;
  let returnedToDesignsAt = 0;
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
    if (UPLOAD_LIMIT_PATTERN.test(text)) {
      throw new Error('Spreadshirt rejected the file because an upload/design limit is still active. ZeroPOD did not mark this artwork as uploaded.');
    }
    if (UPLOAD_ERROR_PATTERN.test(text) || UPLOAD_REJECTION_PATTERN.test(text)) {
      throw new Error(`Spreadshirt rejected the upload. ZeroPOD did not mark this artwork as uploaded. Page text: ${compactDiagnosticText(text) || 'unavailable'}`);
    }

    if (/Upload status/i.test(text)) sawUploadStatus = true;
    if (/Upload successful/i.test(text)) {
      return { ok: true, sawUploadStatus, reason: 'upload-success-text', url };
    }

    // A newly-created design editor is strong, independent evidence that the
    // file really reached Spreadshirt even when its success banner disappears.
    if (MARKETPLACE_DESIGN_EDITOR_RE.test(url)) {
      return { ok: true, sawUploadStatus, reason: 'direct-design-editor', url };
    }
    if (/Design products/i.test(text) && /Metadata/i.test(text)) {
      return { ok: true, sawUploadStatus, reason: 'design-editor-ready', url };
    }

    // IMPORTANT: returning to the Designs index is NOT upload success. We used to
    // accept this transition after Upload Status closed, which produced false
    // positives when Spreadshirt never accepted the file. Give the UI a short
    // grace period for a late success/editor transition, then fail safely.
    const dialogVisible = await uploadDialogVisible(page);
    const returnedWithoutConfirmation = sawUploadStatus
      && MARKETPLACE_DESIGNS_INDEX_RE.test(url)
      && !dialogVisible
      && !/Upload design/i.test(text);

    if (returnedWithoutConfirmation) {
      if (!returnedToDesignsAt) returnedToDesignsAt = Date.now();
      if (Date.now() - returnedToDesignsAt >= 5000) {
        throw new Error(
          'Spreadshirt closed Upload Status and returned to Designs without any verified “Upload successful” confirmation or new design editor. ' +
          'ZeroPOD did not mark the file as uploaded. Retry is safe because no upload success was recorded.'
        );
      }
    } else {
      returnedToDesignsAt = 0;
    }

    await wait(350);
  }

  const diagnostics = compactDiagnosticText(lastText);
  throw new Error(
    `Spreadshirt upload did not reach a verified completion state within ${Math.round(timeoutMs / 1000)} seconds. ` +
    `Current page: ${lastUrl || 'unknown'}. Saw Upload Status: ${sawUploadStatus ? 'yes' : 'no'}. ` +
    `Returned to Designs without confirmation: ${returnedToDesignsAt ? 'yes' : 'no'}. ` +
    `Page text: ${diagnostics || 'unavailable'}`
  );
}

videoFlow.waitForUploadResult = waitForUploadResultReliable;

module.exports = {
  waitForUploadResultReliable,
  MARKETPLACE_DESIGNS_INDEX_RE,
  MARKETPLACE_DESIGN_EDITOR_RE,
  UPLOAD_LIMIT_PATTERN,
  UPLOAD_REJECTION_PATTERN
};
