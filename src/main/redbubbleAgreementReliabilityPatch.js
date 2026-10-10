const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isChecked(locator) {
  if (!(await locator.count().catch(() => 0))) return false;
  return locator.isChecked().catch(async () => locator.evaluate((el) => Boolean(el.checked || el.getAttribute('aria-checked') === 'true')).catch(() => false));
}

async function agreementLocator(page) {
  const direct = page.locator([
    'input[type="checkbox"][name="rights_declaration"]',
    'input[type="checkbox"]#rightsDeclaration',
    'input[type="checkbox"][id*="rights" i]',
    'input[type="checkbox"][name*="rights" i]'
  ].join(', ')).first();
  if (await direct.count().catch(() => 0)) return direct;

  const labelled = page.getByRole('checkbox', { name: /i agree to the redbubble user agreement/i }).first();
  if (await labelled.count().catch(() => 0)) return labelled;

  const text = page.getByText(/i agree to the redbubble user agreement/i, { exact: false }).last();
  if (await text.isVisible().catch(() => false)) {
    const scope = text.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]');
    const checkbox = scope.locator('input[type="checkbox"]').first();
    if (await checkbox.count().catch(() => 0)) return checkbox;
  }

  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count().catch(() => 0);
  if (count) return checkboxes.nth(count - 1);
  return null;
}

async function clickAssociatedLabel(page, checkbox) {
  const id = await checkbox.getAttribute('id').catch(() => null);
  if (id) {
    const label = page.locator(`label[for="${String(id).replace(/"/g, '\\"')}"]`).first();
    if (await label.isVisible().catch(() => false)) {
      await label.click({ force: true, timeout: 2500 }).catch(() => {});
      return true;
    }
  }

  const wrapping = checkbox.locator('xpath=ancestor::label[1]');
  if (await wrapping.isVisible().catch(() => false)) {
    await wrapping.click({ force: true, timeout: 2500 }).catch(() => {});
    return true;
  }
  return false;
}

RedbubbleController.prototype.ensureAgreementChecked = async function ensureAgreementCheckedReliable(page) {
  // Redbubble occasionally renders the checkbox before its React handler is fully
  // ready. Give the editor a brief stabilization window, then reacquire the input
  // on every attempt because React can replace the node after an interaction.
  await wait(250);

  let lastDiagnostic = 'checkbox not found';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const checkbox = await agreementLocator(page);
    if (!checkbox) {
      lastDiagnostic = 'agreement checkbox not found';
      await wait(300);
      continue;
    }

    await checkbox.scrollIntoViewIfNeeded().catch(() => {});
    if (await isChecked(checkbox)) return true;

    // 1) Standard Playwright check — preferred when Redbubble is fully hydrated.
    await checkbox.check({ force: true, timeout: 2500 }).catch(() => {});
    await wait(120);
    if (await isChecked(checkbox)) return true;

    // 2) DOM click bypasses hit-testing/overlay issues while still firing the
    // browser's normal checkbox click/change sequence.
    await checkbox.evaluate((el) => {
      if (!el.checked) el.click();
    }).catch(() => {});
    await wait(120);
    if (await isChecked(checkbox)) return true;

    // 3) Some Redbubble layouts wire the handler to the visual label instead.
    await clickAssociatedLabel(page, checkbox).catch(() => false);
    await wait(120);
    if (await isChecked(checkbox)) return true;

    // 4) Final controlled-input fallback: use the native checked setter and emit
    // input/change events so React receives checked=true rather than merely a DOM
    // attribute mutation.
    await checkbox.evaluate((el) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(el, true);
      else el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(() => {});
    await wait(180);
    if (await isChecked(checkbox)) return true;

    lastDiagnostic = await checkbox.evaluate((el) => JSON.stringify({
      id: el.id || null,
      name: el.getAttribute('name'),
      checked: Boolean(el.checked),
      ariaChecked: el.getAttribute('aria-checked'),
      disabled: Boolean(el.disabled),
      outer: el.outerHTML.slice(0, 300)
    })).catch(() => `attempt ${attempt}: checkbox state unavailable`);

    await wait(300);
  }

  throw new Error(`Redbubble agreement checkbox could not be activated after verified retries. ${lastDiagnostic}`);
};

module.exports = {};
