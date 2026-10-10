const { VectorizerController } = require('./vectorizerController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findFinalDownloadControl(page) {
  // Prefer a real accessibility-role button first. This is the safest path when
  // Vectorizer exposes the final control semantically.
  try {
    const roleButtons = page.getByRole('button', { name: /download/i });
    const count = Math.min(await roleButtons.count().catch(() => 0), 20);
    let best = null;
    for (let i = 0; i < count; i += 1) {
      const locator = roleButtons.nth(i);
      if (!(await locator.isVisible().catch(() => false))) continue;
      if (!(await locator.isEnabled().catch(() => true))) continue;
      const box = await locator.boundingBox().catch(() => null);
      if (!box || box.width <= 0 || box.height < 20) continue;
      const label = await locator.evaluate((element) => [
        element.innerText || element.textContent || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || ''
      ].join(' ').replace(/\s+/g, ' ').trim()).catch(() => 'Download');
      const exact = /^download(?:\s+svg)?$/i.test(label) ? 1 : 0;
      const score = (exact * 1000000) + (box.width * box.height);
      if (!best || score > best.score) best = { locator, score, box, label };
    }
    if (best) {
      return {
        locator: best.locator,
        diagnostic: `Selected semantic BUTTON “${String(best.label).slice(0, 120)}” at ${Math.round(best.box.width)}x${Math.round(best.box.height)}.`
      };
    }
  } catch {}

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

    const isInteractive = (element) => {
      if (!(element instanceof Element)) return false;
      const tag = element.tagName;
      const role = (element.getAttribute('role') || '').toLowerCase();
      const type = (element.getAttribute('type') || '').toLowerCase();
      if (tag === 'BUTTON') return true;
      if (tag === 'A' && element.hasAttribute('href')) return true;
      if (tag === 'INPUT' && ['button', 'submit'].includes(type)) return true;
      if (role === 'button' || role === 'link') return true;
      if (element.hasAttribute('onclick') || typeof element.onclick === 'function') return true;
      const style = getComputedStyle(element);
      if (style.cursor === 'pointer') return true;
      if (element.tabIndex >= 0 && /\bdownload\b/i.test(labelFor(element))) return true;
      return false;
    };

    const interactiveAncestor = (element) => {
      let current = element;
      for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
        if (isInteractive(current)) return current;
      }
      // Important: never return a plain text node/heading as a click target.
      // The previous hotfix returned the original H3 when no clickable ancestor
      // existed, which is exactly the live failure reported by ZeroPOD.
      return null;
    };

    const candidateSet = new Set();
    const seeds = document.querySelectorAll([
      'button',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      'input[type="button"]',
      'input[type="submit"]',
      '[aria-label*="download" i]',
      '[title*="download" i]',
      '[data-testid*="download" i]',
      '[class*="download" i]'
    ].join(','));

    for (const seed of seeds) {
      const candidate = interactiveAncestor(seed);
      if (candidate) candidateSet.add(candidate);
    }

    // Vectorizer has changed the final button wrapper more than once. Include
    // exact rendered Download text only when it resolves to a genuinely clickable
    // element/ancestor. Plain H1/H2/H3 headings are deliberately discarded.
    for (const element of document.querySelectorAll('body *')) {
      const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^download(?:\s+svg)?$/i.test(text)) continue;
      const candidate = interactiveAncestor(element);
      if (candidate) candidateSet.add(candidate);
    }

    const candidates = [...candidateSet]
      .filter((element) => visible(element) && !disabled(element) && isInteractive(element))
      .map((element) => {
        const r = element.getBoundingClientRect();
        const label = labelFor(element);
        if (!/\bdownload\b/i.test(label)) return null;

        let score = r.width * r.height;
        if (/^download(?:\s+svg)?$/i.test(label)) score += 1000000;
        if (/\bsvg\b/i.test(label)) score += 50000;
        if (element.tagName === 'BUTTON') score += 50000;
        if (element.getAttribute('role') === 'button') score += 30000;
        if (element.tagName === 'A') score += 15000;
        if (r.height >= 28 && r.height <= 100) score += 20000;
        if (r.width >= 70) score += 5000;
        score -= Math.max(0, r.height - 140) * 500;
        score -= Math.max(0, label.length - 40) * 100;

        return {
          element,
          score,
          label,
          tag: element.tagName,
          role: element.getAttribute('role') || '',
          cursor: getComputedStyle(element).cursor,
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
        diagnostic: 'No visible enabled clickable Download control was found on the Vectorizer options page.'
      };
    }

    const token = `zeropod-vectorizer-final-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chosen.element.setAttribute('data-zeropod-final-download', token);
    return {
      token,
      diagnostic: `Selected ${chosen.tag}${chosen.role ? `[role=${chosen.role}]` : ''} “${chosen.label.slice(0, 120)}” at ${chosen.width}x${chosen.height}, cursor=${chosen.cursor}.`
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

  // Find only a genuinely clickable final Download control. This explicitly
  // prevents the page's H3 "Download" heading from being treated as the button.
  const discovered = await findFinalDownloadControl(page);
  control = discovered.locator;
  diagnostic = discovered.diagnostic;

  // Keep the existing fast finder as a compatibility fallback. It only searches
  // button/a/role=button controls, so unlike the old DOM scan it cannot choose H3.
  if (!control) {
    control = await this.findLargestDownloadControl(page, { minWidth: 0 }).catch(() => null);
    if (control) diagnostic = `${diagnostic} Fast fallback found a clickable Download control.`;
  }

  if (!control) {
    // Some Vectorizer layouts expose a signed SVG link even when the button wrapper
    // is not detectable. Validate the actual response bytes before accepting it.
    const direct = await this.tryDirectSvgHref(page, projectDir).catch(() => null);
    if (direct) return direct;
    throw new Error(`Vectorizer.ai final SVG Download button was not found. ${diagnostic}`.trim());
  }

  // Arm a direct download-event waiter before the click. The existing capture
  // listener remains active too, giving us two independent ways to receive the file.
  const downloadEvent = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
  await this.clickControl(page, control, 'Vectorizer.ai final SVG Download button');

  const immediateDownload = await Promise.race([
    downloadEvent,
    wait(3500).then(() => null)
  ]);
  if (immediateDownload) {
    const saved = await this.saveSvgDownload(immediateDownload, projectDir).catch(() => null);
    if (saved) return saved;
  }

  const captured = await waitForSvgCapture(this, page, projectDir, downloads, baseline, 30000);
  if (captured) return captured;

  const direct = await this.tryDirectSvgHref(page, projectDir).catch(() => null);
  if (direct) return direct;

  throw new Error(`Vectorizer.ai final Download was clicked, but no valid SVG file was captured. ${diagnostic}`.trim());
};

module.exports = { findFinalDownloadControl };
