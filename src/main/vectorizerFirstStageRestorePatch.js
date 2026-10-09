const { VectorizerController } = require('./vectorizerController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function visibleEnabled(locator) {
  if (!(await locator.count().catch(() => 0))) return false;
  if (!(await locator.isVisible().catch(() => false))) return false;
  return locator.evaluate((element) => {
    const disabled = element.disabled === true
      || element.getAttribute('aria-disabled') === 'true'
      || element.hasAttribute('disabled');
    const style = window.getComputedStyle(element);
    return !disabled && style.visibility !== 'hidden' && style.display !== 'none';
  }).catch(() => false);
}

// This intentionally mirrors the original Hotfix 18 finder for the FIRST
// Vectorizer result-page Download button. Do not replace this with the fast
// DOM-index scan used for the second/final Download button; the result page
// contains multiple Download controls and the original Playwright walk was the
// known-good selection behavior.
async function legacyFindLargestDownloadControl(page, { minWidth = 0 } = {}) {
  const controls = page.locator('button, a, [role="button"]');
  const count = Math.min(await controls.count().catch(() => 0), 300);
  let best = null;

  for (let i = 0; i < count; i += 1) {
    const locator = controls.nth(i);
    if (!(await visibleEnabled(locator))) continue;

    const label = await locator.evaluate((element) => [
      element.innerText || element.textContent || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || ''
    ].join(' ')).catch(() => '');
    if (!/\bdownload\b/i.test(label)) continue;

    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width < minWidth || box.height < 20) continue;
    const score = box.width * box.height;
    if (!best || score > best.score) best = { locator, score };
  }

  return best?.locator || null;
}

VectorizerController.prototype.waitForResultReady = async function waitForResultReadyOriginalFirstStage(page, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await this.isDownloadOptionsPage(page)) return { stage: 'options', control: null };

    // Restore the original first-button detection exactly. The Hotfix 22 speed
    // optimization remains active for the second/final Download through the
    // globally patched findLargestDownloadControl used by clickFinalSvgDownload.
    const control = await legacyFindLargestDownloadControl(page, { minWidth: 100 });
    if (control) return { stage: 'result', control };

    await wait(300);
  }

  throw new Error('Vectorizer.ai did not expose the finished result Download button before timeout.');
};

module.exports = { legacyFindLargestDownloadControl };
