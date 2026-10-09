const { RedbubbleController } = require('./redbubbleController');
const { VectorizerController } = require('./vectorizerController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function copySettingsVisible(page) {
  const direct = page.getByText(/^copy settings$/i, { exact: true }).first();
  if (await direct.isVisible().catch(() => false)) return true;
  const duplicate = page.locator('a[href*="/duplicate"]').first();
  return duplicate.isVisible().catch(() => false);
}

async function firstArtworkGeometry(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return r.width > 0 && r.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    };

    const search = [...document.querySelectorAll('input')].find((input) => /search your works/i.test(input.placeholder || ''));
    const searchBottom = search?.getBoundingClientRect?.().bottom || 250;

    const images = [...document.querySelectorAll('img')]
      .filter((img) => {
        if (!visible(img)) return false;
        const r = img.getBoundingClientRect();
        return r.width >= 90 && r.height >= 90 && r.top >= searchBottom - 10;
      })
      .map((img) => ({ img, rect: img.getBoundingClientRect() }))
      .sort((a, b) => Math.abs(a.rect.top - b.rect.top) > 10 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left);

    let chosen = images[0] || null;

    if (!chosen) {
      const cardLinks = [...document.querySelectorAll('a[href]')]
        .filter((a) => visible(a) && /portfolio|works|images/i.test(a.href || ''))
        .map((a) => ({ img: a, rect: a.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width >= 90 && rect.height >= 90 && rect.top >= searchBottom - 10)
        .sort((a, b) => Math.abs(a.rect.top - b.rect.top) > 10 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left);
      chosen = cardLinks[0] || null;
    }

    if (!chosen) return null;
    const r = chosen.rect;

    const candidates = [...document.querySelectorAll('*')]
      .filter((el) => {
        if (!visible(el)) return false;
        const b = el.getBoundingClientRect();
        if (b.width < 18 || b.width > 72 || b.height < 18 || b.height > 72) return false;
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        const inTopRight = cx >= r.left + r.width * 0.68
          && cx <= r.right + 22
          && cy >= r.top - 18
          && cy <= r.top + Math.min(82, r.height * 0.38);
        if (!inTopRight) return false;
        const role = el.getAttribute('role') || '';
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`;
        const cursor = getComputedStyle(el).cursor;
        return el.tagName === 'BUTTON' || el.tagName === 'A' || role === 'button' || cursor === 'pointer' || el.querySelector('svg');
      })
      .map((el) => {
        const b = el.getBoundingClientRect();
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`;
        let score = 0;
        if (/settings|options|actions|more/i.test(label)) score += 10000;
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') score += 3000;
        if (el.querySelector('svg')) score += 1500;
        score -= Math.abs((b.left + b.width / 2) - (r.right - 20)) * 8;
        score -= Math.abs((b.top + b.height / 2) - (r.top + 20)) * 8;
        return {
          x: b.left + b.width / 2,
          y: b.top + b.height / 2,
          width: b.width,
          height: b.height,
          label: label.trim(),
          score
        };
      })
      .sort((a, b) => b.score - a.score);

    return {
      image: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      candidate: candidates[0] || null,
      candidateCount: candidates.length
    };
  }).catch(() => null);
}

RedbubbleController.prototype.clickFirstSettingsGear = async function clickFirstSettingsGearGeometry(page) {
  // Keep semantic selectors as a cheap first path when Redbubble exposes labels.
  const semantic = [
    page.getByRole('button', { name: /settings|actions|options|more/i }).first(),
    page.locator('button[aria-label*="settings" i], button[title*="settings" i]').first(),
    page.locator('[role="button"][aria-label*="settings" i], [role="button"][title*="settings" i]').first()
  ];
  for (const locator of semantic) {
    try {
      if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
        await locator.click({ force: true, timeout: 1000 });
        if (await copySettingsVisible(page)) return true;
      }
    } catch {}
  }

  const started = Date.now();
  let lastGeometry = null;
  while (Date.now() - started < 12000) {
    const geometry = await firstArtworkGeometry(page);
    if (!geometry) {
      await wait(180);
      continue;
    }
    lastGeometry = geometry;

    const attempts = [];
    if (geometry.candidate) attempts.push({ x: geometry.candidate.x, y: geometry.candidate.y });
    attempts.push(
      { x: geometry.image.right - 20, y: geometry.image.top + 20 },
      { x: geometry.image.right - 28, y: geometry.image.top + 28 },
      { x: geometry.image.right - 14, y: geometry.image.top + 14 }
    );

    for (const point of attempts) {
      try {
        await page.mouse.click(point.x, point.y);
        for (let i = 0; i < 8; i += 1) {
          if (await copySettingsVisible(page)) return true;
          await wait(80);
        }
      } catch {}
    }

    await wait(220);
  }

  const diagnostic = lastGeometry
    ? ` First artwork ${Math.round(lastGeometry.image.width)}×${Math.round(lastGeometry.image.height)} at (${Math.round(lastGeometry.image.left)},${Math.round(lastGeometry.image.top)}); top-right candidates: ${lastGeometry.candidateCount}.`
    : ' No visible artwork card geometry was detected.';
  throw new Error(`The first Redbubble work settings circle was visible but ZeroPOD could not activate it.${diagnostic}`);
};

VectorizerController.prototype.findLargestDownloadControl = async function findLargestDownloadControlFast(page, { minWidth = 0 } = {}) {
  // Do one DOM pass instead of hundreds of Playwright round-trips. The old
  // implementation inspected up to 300 controls individually and could take
  // 50-60 seconds on the Vectorizer options page.
  const controls = page.locator('button, a, [role="button"]');
  const bestIndex = await controls.evaluateAll((elements, minimumWidth) => {
    let best = null;
    elements.forEach((element, index) => {
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const disabled = element.disabled === true
        || element.getAttribute('aria-disabled') === 'true'
        || element.hasAttribute('disabled');
      if (disabled || r.width < minimumWidth || r.height < 20) return;
      if (r.width <= 0 || r.height <= 0 || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return;
      const label = [
        element.innerText || element.textContent || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || ''
      ].join(' ');
      if (!/\bdownload\b/i.test(label)) return;
      const score = r.width * r.height;
      if (!best || score > best.score) best = { index, score };
    });
    return best?.index ?? -1;
  }, minWidth).catch(() => -1);

  return bestIndex >= 0 ? controls.nth(bestIndex) : null;
};

VectorizerController.prototype.waitForDownloadOptions = async function waitForDownloadOptionsFast(page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /File format/i.test(text) && /Optimize for/i.test(text) && /\bSVG\b/i.test(text) && /\bDownload\b/i.test(text);
    }).catch(() => false);
    if (ready) return true;
    await wait(90);
  }
  return false;
};

module.exports = { firstArtworkGeometry };
