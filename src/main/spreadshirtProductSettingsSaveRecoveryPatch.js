const videoFlow = require('./spreadshirtVideoFlowPatch');
const placement = require('./spreadshirtRecordedPlacementPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousWaitForProductsCreated = videoFlow.waitForProductsCreated;

async function visible(locator) {
  try { return Boolean(await locator.count()) && await locator.isVisible(); } catch { return false; }
}

async function visibleProductSettings(page) {
  for (const frame of page.frames()) {
    const heading = frame.getByText(/^Product settings$/i, { exact: true }).first();
    if (await visible(heading)) return true;
  }
  return false;
}

async function visibleDesignProducts(page) {
  for (const frame of page.frames()) {
    const heading = frame.getByText(/^Design products$/i, { exact: true }).first();
    if (await visible(heading)) return true;
  }
  return false;
}

async function findSave(page) {
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
      return { locator: candidate, disabled };
    }
  }
  return null;
}

async function clickBack(page) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.getByRole('button', { name: /^Back$/i }).first(),
      frame.getByRole('link', { name: /^Back$/i }).first(),
      frame.getByText(/^Back$/i, { exact: true }).first()
    ];
    for (const candidate of candidates) {
      if (!(await visible(candidate))) continue;
      await candidate.click({ force: true, timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function waitUntilBackInEditor(page, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const inSettings = await visibleProductSettings(page);
    const inEditor = await visibleDesignProducts(page);
    if (!inSettings && inEditor) return true;
    await wait(200);
  }
  return false;
}

async function waitForProductRegeneration(page, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await visibleProductSettings(page))) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Products created/i.test(text) && /Metadata/i.test(text)) return true;
      if (/Design products/i.test(text) && /Change settings/i.test(text)) return true;
    }
    await wait(250);
  }
  return false;
}

async function recoverProductSettingsExit(page) {
  if (!(await visibleProductSettings(page))) return false;

  const fullFront = await placement.fullFrontSelectionState(page);
  if (!(fullFront.found && fullFront.selected === true)) {
    throw new Error('Spreadshirt is still in Product settings and Full front is not confirmed selected.');
  }

  const save = await findSave(page);
  if (save && !save.disabled) {
    await save.locator.scrollIntoViewIfNeeded().catch(() => {});
    await save.locator.click({ timeout: 7000 }).catch(async () => {
      await save.locator.click({ force: true, timeout: 7000 });
    });
    const returned = await waitUntilBackInEditor(page, 25000);
    if (!returned) {
      throw new Error('Spreadshirt Product settings Save was clicked, but ZeroPOD did not return to Design products.');
    }
    await waitForProductRegeneration(page, 30000);
    return true;
  }

  if (save?.disabled) {
    const backed = await clickBack(page);
    if (!backed) throw new Error('Spreadshirt Full front is selected but Product settings Save is disabled and Back was not found.');
    const returned = await waitUntilBackInEditor(page, 20000);
    if (!returned) throw new Error('Spreadshirt left Product settings, but Design products did not return.');
    return true;
  }

  throw new Error('Spreadshirt is still in Product settings after Full front selection, but the Save button was not found.');
}

videoFlow.waitForProductsCreated = async function waitForProductsCreatedWithSettingsExit(page, timeoutMs = 45000) {
  const result = await previousWaitForProductsCreated(page, timeoutMs);
  await recoverProductSettingsExit(page);
  return result;
};

module.exports = {
  recoverProductSettingsExit,
  visibleProductSettings,
  waitUntilBackInEditor
};
