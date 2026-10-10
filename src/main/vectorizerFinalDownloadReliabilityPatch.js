const { VectorizerController } = require('./vectorizerController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findFinalDownloadControl(page) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return r.width > 0
        && r.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    };

    const disabled = (element) => element.disabled === true
      || element.getAttribute('aria-disabled') === 'true'
      || element.hasAttribute('disabled');

    const labelFor = (element) => [
      element.innerText || element.textContent || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.getAttribute('value') || '',
      element.getAttribute('data-testid') || ''
    ].join(' ').replace(/\s+/g, ' ').trim();

    const interactiveAncestor = (element) => {
      let current = element;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        const role = current.getAttribute?.('role') || '';
        const style = current instanceof Element ? getComputedStyle(current) : null;
        if (current.tagName === 'BUTTON'
          || current.tagName === 'A'
          || current.tagName === 'INPUT'
          || role === 'button'
          || style?.cursor === 'pointer') return current;
      }
      return element;
    };

    const candidateSet = new Set([
      ...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], [aria-label*="download" i], [title*="download" i], [data-testid*="download" i]')
    ]);

    // Vectorizer has changed the final button wrapper more than once. Include
    // visible elements whose rendered text says Download and climb to the nearest
    // clickable ancestor instead of assuming a specific tag/class.
    for (const element of document.querySelectorAll('body *')) {
      const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^download(?:\s+svg)?$/i.test(text)) continue;
      candidateSet.add(interactiveAncestor(element));
    }

    const candidates = [...candidateSet]
      .filter((element) => visible(element) && !disabled(element))
      .map((element) => {
        const r = element.getBoundingClientRect();
        const label = labelFor(element);
        if (!/\bdownload\b/i.test(label)) return null;

        let score = r.width * r.height;
        if (/^download$/i.test(label)) score += 100000;
        if (/\bsvg\b/i.test(label)) score += 25000;
        if (element.tagName === 'BUTTON') score += 12000;
        if (element.getAttribute('role') === 'button') score += 8000;
        if (r.width >= 70) score += 5000;
        if (r.height >= 28) score += 3000;

        return {
          element,
          score,
          label,
          tag: element.tagName,
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const chosen = candidates[0];
    if (!chosen) {
      return {
        token: null,
        diagnostic: 'No visible enabled Download-labelled control was found on the Vectorizer options page.'
      };
    }

    const token = `zeropod-vectorizer-final-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chosen.element.setAttribute('data-zeropod-final-download', token);
    return {
      token,
      diagnostic: `Selected ${chosen.tag} “${chosen.label.slice(0, 120)}” at ${chosen.width}x${chosen.height}.`
    };
  }).catch((error) => ({ token: null, diagnostic: `DOM scan failed: ${error?.message || error}` }));

  if (!result?.token) return { locator: null, diagnostic: result?.diagnostic || 'No final Download control found.' };
  return {
    locator: page.locator(`[data-zeropod-final-download="${result.token}"]`).first(),
    diagnostic: result.diagnostic
  };
}

async function waitForSvgCapture(controller, page, projectDir, downloads, baseline, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    while (downloads.length) {
      const download = downloads.shift();
      const saved = await controller.saveSvgDownload(download, projectDir).catch(() => null);
      if (saved) return saved;
    }

    const diskSvg = controller.findNewSvgOnDisk(projectDir, baseline);
    if (diskSvg) return diskSvg;
    await wait(200);
  }
  return null;
}

VectorizerController.prototype.clickFinalSvgDownload = async function clickFinalSvgDownloadBackgroundSafe(page, projectDir, downloads, baseline) {
  await this.selectSvgFormat(page);

  // Give Vectorizer's reactive UI a moment to redraw after explicitly selecting SVG.
  await wait(250);

  let diagnostic = '';
  let control = null;

  // First use a semantic + geometry scan that does not assume the final button is
  // at least 180px wide. Background Chrome can render this control narrower even
  // though it is fully visible and clickable inside the page viewport.
  const discovered = await findFinalDownloadControl(page);
  control = discovered.locator;
  diagnostic = discovered.diagnostic;

  // Keep the existing fast finder as a compatibility fallback, but remove the
  // brittle width requirement that caused the current false "not found" failure.
  if (!control) {
    control = await this.findLargestDownloadControl(page, { minWidth: 0 }).catch(() => null);
    if (control) diagnostic = `${diagnostic} Fast fallback found a Download control.`;
  }

  if (!control) {
    // Some Vectorizer layouts expose a signed SVG link even when the button wrapper
    // is not detectable. Validate the actual response bytes before accepting it.
    const direct = await this.tryDirectSvgHref(page, projectDir).catch(() => null);
    if (direct) return direct;
    throw new Error(`Vectorizer.ai final SVG Download button was not found. ${diagnostic}`.trim());
  }

  await this.clickControl(page, control, 'Vectorizer.ai final SVG Download button');

  const captured = await waitForSvgCapture(this, page, projectDir, downloads, baseline, 30000);
  if (captured) return captured;

  const direct = await this.tryDirectSvgHref(page, projectDir).catch(() => null);
  if (direct) return direct;

  throw new Error(`Vectorizer.ai final Download was clicked, but no valid SVG file was captured. ${diagnostic}`.trim());
};

module.exports = { findFinalDownloadControl };
