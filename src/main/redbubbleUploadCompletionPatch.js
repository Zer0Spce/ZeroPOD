const { RedbubbleController } = require('./redbubbleController');
const { editorHasMetadataFields } = require('./redbubbleEditorFieldsPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function hasRealUploadBusyState(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    };

    // Trust actual busy/progress semantics first.
    const semanticBusy = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')]
      .some(visible);
    if (semanticBusy) return true;

    // Redbubble permanently renders helper copy such as "Need help uploading?".
    // Never treat body-wide occurrences of the word "uploading" as an active upload.
    // Only accept small, visible status elements whose own text is an upload state.
    const statusPattern = /^(uploading|uploading image|processing image|replacing image|preparing image|please wait)(?:\.{1,3})?$/i;
    const statusNodes = [...document.querySelectorAll('[role="status"], [aria-live], p, span, div')]
      .filter(visible)
      .filter((el) => {
        const text = String(el.innerText || el.textContent || '').trim();
        return text.length > 0 && text.length <= 80 && statusPattern.test(text);
      });

    return statusNodes.length > 0;
  }).catch(() => false);
}

RedbubbleController.prototype.waitForArtworkUpload = async function waitForArtworkUploadWithoutHelpTextFalsePositive(
  page,
  timeoutMs = 120000
) {
  const started = Date.now();
  let stableSince = null;

  while (Date.now() - started < timeoutMs) {
    const busy = await hasRealUploadBusyState(page);
    const fieldsReady = await editorHasMetadataFields(page);

    // The copied-work editor remaining stable with no real progress indicator is
    // enough to advance. Give it a short settling window so React/image state has
    // time to finish updating before metadata is written.
    if (!busy && fieldsReady && Date.now() - started >= 1800) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 1200) return true;
    } else {
      stableSince = null;
    }

    await wait(150);
  }

  throw new Error('Redbubble replacement artwork did not settle before timeout.');
};

module.exports = { hasRealUploadBusyState };
