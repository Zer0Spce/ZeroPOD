const videoFlow = require('./spreadshirtVideoFlowPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalWaitForProductsCreated = videoFlow.waitForProductsCreated;

async function pageText(page) {
  const texts = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 1000 });
      if (text) texts.push(text);
    } catch {}
  }
  return texts.join('\n');
}

async function visible(locator) {
  try { return Boolean(await locator.count()) && await locator.isVisible(); } catch { return false; }
}

async function clickVisibleText(page, pattern) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.getByRole('button', { name: pattern }).first(),
      frame.getByRole('link', { name: pattern }).first(),
      frame.getByText(pattern, { exact: true }).first()
    ];
    for (const candidate of candidates) {
      if (!(await visible(candidate))) continue;
      if (await candidate.isDisabled().catch(() => false)) continue;
      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await candidate.click({ force: true, timeout: 5000 });
        return true;
      } catch {}
    }
  }
  return false;
}

async function clickFullFrontCard(page) {
  for (const frame of page.frames()) {
    const label = frame.getByText(/^Full front$/i, { exact: true }).first();
    if (!(await visible(label))) continue;

    const clicked = await label.evaluate((el) => {
      const visible = (node) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };

      let node = el;
      let target = null;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        const radio = node.querySelector?.('input[type="radio"],[role="radio"]');
        const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (radio || (/Full front/i.test(text) && rect.width >= 80 && rect.height >= 80)) {
          target = node;
          break;
        }
      }
      target = target || el;
      try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      try {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        target.click();
        return true;
      } catch {
        return false;
      }
    }).catch(() => false);

    if (clicked) return true;
  }
  return false;
}

async function ensureFullFrontPlacement(page) {
  let text = await pageText(page);
  if (/Design products/i.test(text) && /Standard placement[\s\S]{0,180}Full front/i.test(text)) {
    return { ok: true, changed: false };
  }

  if (!/Product settings/i.test(text)) {
    const opened = await clickVisibleText(page, /^Change settings$/i);
    if (!opened) throw new Error('Spreadshirt “Change settings” control was not found in Products.');
  }

  const settingsStarted = Date.now();
  while (Date.now() - settingsStarted < 15000) {
    text = await pageText(page);
    if (/Product settings/i.test(text) && /Standard placement/i.test(text)) break;
    await wait(250);
  }
  if (!/Product settings/i.test(text) || !/Standard placement/i.test(text)) {
    throw new Error('Spreadshirt Product settings did not open.');
  }

  const selected = await clickFullFrontCard(page);
  if (!selected) throw new Error('Spreadshirt “Full front” placement option was not found.');
  await wait(350);

  const saved = await clickVisibleText(page, /^Save$/i);
  if (!saved) throw new Error('Spreadshirt Product settings “Save” button was not found.');

  const returnedStarted = Date.now();
  while (Date.now() - returnedStarted < 20000) {
    text = await pageText(page);
    if (/Design products/i.test(text) && /Standard placement[\s\S]{0,180}Full front/i.test(text)) {
      // Spreadshirt recreates products after placement changes. Wait for that second
      // product-creation pass using the original readiness helper, not this wrapper.
      await originalWaitForProductsCreated(page, 45000);
      return { ok: true, changed: true };
    }
    await wait(300);
  }

  throw new Error('Spreadshirt did not confirm Full front as the standard placement after Save.');
}

// spreadshirtCardDetectionPatch imports this exported helper after bootstrap loads this
// module. That makes every normal/resume prepare flow enforce Full front before metadata.
videoFlow.waitForProductsCreated = async function waitForProductsCreatedWithFullFront(page, timeoutMs = 45000) {
  const result = await originalWaitForProductsCreated(page, timeoutMs);
  await ensureFullFrontPlacement(page);
  return result;
};

module.exports = {
  ensureFullFrontPlacement,
  clickFullFrontCard
};
