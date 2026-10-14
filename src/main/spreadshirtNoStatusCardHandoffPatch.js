const videoFlow = require('./spreadshirtVideoFlowPatch');
const {
  waitForUploadResultFromVisibleState
} = require('./spreadshirtCreateNewReliabilityPatch');

const DESIGNS_INDEX_RE = /\/mp\/designs\/?(?:[?#].*)?$/i;
const NO_VISIBLE_STATUS_ERROR = /never showed a VISIBLE [“\"]Upload Status[”\"]/i;

async function waitForUploadResultAllowNoStatusCardHandoff(page, timeoutMs = 60000) {
  try {
    return await waitForUploadResultFromVisibleState(page, timeoutMs);
  } catch (error) {
    const message = String(error?.message || error || '');
    const url = page.url();

    // #525 proved Spreadshirt can accept the file and return to Designs without
    // ever rendering a visible Upload Status modal. At this point the file has
    // already been selected from the verified visible upload surface, so the
    // safe next step is NOT to record success. Hand off to the existing fresh-
    // card verifier and require a genuinely new card before uploadAcceptedAt is
    // written. This preserves duplicate/previous-card protection while allowing
    // Spreadshirt's no-status success path.
    if (NO_VISIBLE_STATUS_ERROR.test(message) && DESIGNS_INDEX_RE.test(url)) {
      return {
        ok: true,
        confirmed: false,
        needsCardVerification: true,
        sawUploadStatus: false,
        reason: 'verified-file-selection-no-visible-status-needs-card-verification',
        url
      };
    }

    throw error;
  }
}

videoFlow.waitForUploadResult = waitForUploadResultAllowNoStatusCardHandoff;

module.exports = {
  waitForUploadResultAllowNoStatusCardHandoff
};
