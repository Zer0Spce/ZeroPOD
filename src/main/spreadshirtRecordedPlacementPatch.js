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

async function fullFrontSelectionState(page) {
  for (const frame of page.frames()) {
    const label = frame.getByText(/^Full front$/i, { exact: true }).first();
    if (!(await visible(label))) continue;

    const state = await label.evaluate((el) => {
      const visible = (node) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const selectedByAttributes = (node) => {
        if (!node) return false;
        if (node.matches?.('input[type="radio"],input[type="checkbox"]') && node.checked) return true;
        if (node.getAttribute?.('aria-checked') === 'true') return true;
        if (node.getAttribute?.('aria-selected') === 'true') return true;
        if (node.getAttribute?.('data-selected') === 'true') return true;
        if (node.getAttribute?.('data-state') === 'checked') return true;
        return false;
      };

      let node = el;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!/Full front/i.test(text)) continue;

        const controls = [
          node.matches?.('input[type="radio"],[role="radio"]') ? node : null,
          node.querySelector?.('input[type="radio"]'),
          node.querySelector?.('[role="radio"]'),
          node.querySelector?.('[aria-checked="true"]'),
          node.querySelector?.('[aria-selected="true"]'),
          node.querySelector?.('[data-selected="true"]'),
          node.querySelector?.('[data-state="checked"]')
        ].filter(Boolean);

        const selected = controls.some(selectedByAttributes)
          || node.getAttribute?.('aria-checked') === 'true'
          || node.getAttribute?.('aria-selected') === 'true'
          || node.getAttribute?.('data-selected') === 'true'
          || node.getAttribute?.('data-state') === 'checked'
          || /(^|\s)(selected|active|checked)(\s|$)/i.test(String(node.className || ''));

        const rect = node.getBoundingClientRect();
        if (controls.length || (rect.width >= 80 && rect.height >= 80)) {
          return { found: true, selected: Boolean(selected), text: text.slice(0, 160) };
        }
      }

      return { found: true, selected: null, text: String(el.textContent || '').trim() };
    }).catch(() => null);

    if (state) return state;
  }
  return { found: false, selected: null };
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

async function productSettingsSaveState(page) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.getByRole('button', { name: /^Save$/i }).first(),
      frame.locator('button').filter({ hasText: /^Save$/i }).first(),
      frame.locator('input[type="submit"][value="Save" i]').first(),
      frame.locator('input[type="button"][value="Save" i]').first()
    ];
    for (const candidate of candidates) {
      if (!(await visible(candidate))) continue;
      const disabled = await candidate.isDisabled().catch(() => false)
        || await candidate.getAttribute('aria-disabled').catch(() => null) === 'true';
      return { found: true, disabled, locator: candidate };
    }
  }
  return { found: false, disabled: null, locator: null };
}

async function waitForDesignProductsFullFront(page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await pageText(page);
    if (/Design products/i.test(text) && /Standard placement[\s\S]{0,220}Full front/i.test(text)) {
      return true;
    }
    await wait(250);
  }
  return false;
}

async function leaveAlreadyFullFrontSettings(page) {
  const backed = await clickVisibleText(page, /^Back$/i);
  if (!backed) {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  }
  return waitForDesignProductsFullFront(page, 20000);
}

async function ensureFullFrontPlacement(page) {
  let text = await pageText(page);
  if (/Design products/i.test(text) && /Standard placement[\s\S]{0,180}Full front/i.test(text)) {
    return { ok: true, changed: false, method: 'summary-already-full-front' };
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

  // Full front is often already selected in Spreadshirt's current editor. In that
  // case the top-right Save button stays disabled, so there is nothing to save.
  const initialState = await fullFrontSelectionState(page);
  if (initialState.found && initialState.selected === true) {
    const left = await leaveAlreadyFullFrontSettings(page);
    if (!left) {
      throw new Error('Spreadshirt Full front was already selected, but ZeroPOD could not return to Design products.');
    }
    return { ok: true, changed: false, method: 'already-selected-back' };
  }

  const selected = await clickFullFrontCard(page);
  if (!selected) throw new Error('Spreadshirt “Full front” placement option was not found.');

  // Wait for Spreadshirt to apply the selection and for Save to become enabled.
  let selectionConfirmed = false;
  const selectionStarted = Date.now();
  while (Date.now() - selectionStarted < 6000) {
    const state = await fullFrontSelectionState(page);
    if (state.found && state.selected === true) {
      selectionConfirmed = true;
      break;
    }
    await wait(150);
  }

  const saveStarted = Date.now();
  let lastSaveState = { found: false, disabled: null, locator: null };
  while (Date.now() - saveStarted < 15000) {
    // Some Spreadshirt builds immediately return after applying a placement.
    if (await waitForDesignProductsFullFront(page, 250)) {
      await originalWaitForProductsCreated(page, 45000);
      return { ok: true, changed: true, method: 'auto-returned' };
    }

    lastSaveState = await productSettingsSaveState(page);
    if (lastSaveState.found && !lastSaveState.disabled) {
      await lastSaveState.locator.scrollIntoViewIfNeeded().catch(() => {});
      await lastSaveState.locator.click({ force: true, timeout: 5000 });
      const returned = await waitForDesignProductsFullFront(page, 20000);
      if (!returned) {
        throw new Error('Spreadshirt Product settings Save was clicked, but Full front was not confirmed in Design products.');
      }
      await originalWaitForProductsCreated(page, 45000);
      return { ok: true, changed: true, method: 'saved' };
    }

    // If Save is visible but disabled while Full front is selected, this was a no-op:
    // the desired placement was already active. Exit safely and verify the summary.
    if (lastSaveState.found && lastSaveState.disabled) {
      const state = await fullFrontSelectionState(page);
      if ((state.found && state.selected === true) || selectionConfirmed) {
        const left = await leaveAlreadyFullFrontSettings(page);
        if (left) return { ok: true, changed: false, method: 'disabled-save-already-full-front' };
      }
    }

    await wait(200);
  }

  const state = await fullFrontSelectionState(page);
  if ((state.found && state.selected === true) || selectionConfirmed) {
    const left = await leaveAlreadyFullFrontSettings(page);
    if (left) return { ok: true, changed: false, method: 'full-front-selected-no-save-needed' };
  }

  throw new Error(`Spreadshirt Product settings could not save Full front placement. Save found: ${lastSaveState.found ? 'yes' : 'no'}${lastSaveState.found ? `; disabled: ${lastSaveState.disabled ? 'yes' : 'no'}` : ''}.`);
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
  clickFullFrontCard,
  fullFrontSelectionState,
  productSettingsSaveState,
  waitForDesignProductsFullFront
};
