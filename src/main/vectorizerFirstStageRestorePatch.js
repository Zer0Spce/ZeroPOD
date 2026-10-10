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

// Live testing showed an intermittent first-run race: the proven result Download
// button is found and clicked, but Vectorizer occasionally ignores that first
// click. Manually pressing Resume succeeds because the same result page is still
// open and the next click works. Keep the known-good finder/click path unchanged,
// but automatically perform that resume-like retry before surfacing recovery.
VectorizerController.prototype.clickResultDownload = async function clickResultDownloadWithRetry(page, resultControl) {
  if (await this.isDownloadOptionsPage(page)) return true;

  let control = resultControl;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await this.isDownloadOptionsPage(page)) return true;

    if (!control || !(await visibleEnabled(control))) {
      control = await legacyFindLargestDownloadControl(page, { minWidth: 100 }).catch(() => null);
    }

    if (!control) {
      // The result card may be rerendering between attempts. Give it a short
      // chance to settle, then reacquire the same known-good large Download.
      const state = await this.waitForResultReady(page, 8000).catch(() => null);
      if (state?.stage === 'options') return true;
      control = state?.control || null;
    }

    if (!control) {
      if (attempt < maxAttempts) {
        await wait(1000);
        continue;
      }
      throw new Error('Vectorizer.ai result Download button was not available for retry.');
    }

    await this.clickControl(page, control, `Vectorizer.ai result Download button (attempt ${attempt}/${maxAttempts})`);

    // Most successful transitions happen quickly. A shorter per-attempt wait lets
    // us self-heal faster than the old one-shot 20 second timeout while still
    // allowing slower SPA navigation to complete.
    const reachedOptions = await this.waitForDownloadOptions(page, attempt === 1 ? 10000 : 8000);
    if (reachedOptions) return true;

    // Do not reuse a possibly stale element after Vectorizer rerenders. This is
    // effectively the same safe action the user was doing by pressing Resume.
    control = null;
    await wait(1200);
  }

  // One last passive grace period covers a click that navigated late while the
  // third attempt's wait was expiring.
  if (await this.waitForDownloadOptions(page, 8000)) return true;

  throw new Error('Vectorizer.ai result Download button was clicked 3 times, but the SVG download/options page did not open.');
};

module.exports = { legacyFindLargestDownloadControl };
