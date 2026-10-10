const { clipboard } = require('electron');
const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousFillListingFields = RedbubbleController.prototype.fillListingFields;

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function locateDescription(page) {
  const marker = await page.evaluate(() => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const label = nodes.find((el) => tidy(el.innerText || el.textContent) === 'Description');
    if (!label) return null;
    const lr = label.getBoundingClientRect();
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top >= lr.bottom - 10 && r.top <= lr.bottom + 520)
      .sort((a, b) => (Math.max(0, a.r.top - lr.bottom) * 4 + Math.abs(a.r.left - lr.left)) - (Math.max(0, b.r.top - lr.bottom) * 4 + Math.abs(b.r.left - lr.left)));
    if (!candidates.length) return null;
    const token = `zeropod-description-paste-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    candidates[0].el.setAttribute('data-zeropod-description-paste', token);
    return token;
  }).catch(() => null);
  return marker ? page.locator(`[data-zeropod-description-paste="${marker}"]`).first() : null;
}

async function readValue(locator) {
  return locator.evaluate((el) => 'value' in el ? String(el.value || '') : String(el.innerText || el.textContent || '')).catch(() => '');
}

async function targetInfo(locator) {
  return locator.evaluate((el) => ({
    tag: el.tagName,
    readOnly: Boolean(el.readOnly),
    disabled: Boolean(el.disabled),
    maxLength: typeof el.maxLength === 'number' ? el.maxLength : -1,
    focused: document.activeElement === el
  })).catch(() => null);
}

async function focusAndClear(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.evaluate((el) => el.focus()).catch(() => {});
  await locator.click({ force: true }).catch(() => {});
  await wait(80);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await wait(80);
}

async function pasteAndVerify(page, locator, desired) {
  clipboard.writeText(desired);
  await focusAndClear(page, locator);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V').catch(() => {});
  await wait(350);
  return norm(await readValue(locator)) === norm(desired);
}

async function fillAndVerify(page, locator, desired) {
  await focusAndClear(page, locator);
  await locator.fill(desired).catch(() => {});
  await wait(250);
  return norm(await readValue(locator)) === norm(desired);
}

async function nativeReactSetAndVerify(locator, desired) {
  await locator.evaluate((el, next) => {
    el.focus();
    const oldValue = 'value' in el ? String(el.value || '') : String(el.innerText || el.textContent || '');
    if (el instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, next);
    else if (el instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, next);
    else el.textContent = next;
    if (el._valueTracker && typeof el._valueTracker.setValue === 'function') el._valueTracker.setValue(oldValue);
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: next }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, desired).catch(() => {});
  await wait(300);
  return norm(await readValue(locator)) === norm(desired);
}

async function typeAndVerify(page, locator, desired) {
  await focusAndClear(page, locator);
  await page.keyboard.insertText(desired).catch(async () => page.keyboard.type(desired, { delay: 1 }).catch(() => {}));
  await wait(300);
  return norm(await readValue(locator)) === norm(desired);
}

async function writeDescription(page, rawValue) {
  let desired = String(rawValue || '').trim();
  if (!desired) throw new Error('ZeroPOD metadata Description is empty.');
  const locator = await locateDescription(page);
  if (!locator || !(await locator.count().catch(() => 0))) throw new Error('Redbubble Description editor could not be located.');
  const info = await targetInfo(locator);
  if (info?.disabled || info?.readOnly) throw new Error('Redbubble Description editor is not writable.');
  if (info?.maxLength > 0 && desired.length > info.maxLength) desired = desired.slice(0, info.maxLength).trimEnd();

  const strategies = [
    () => pasteAndVerify(page, locator, desired),
    () => fillAndVerify(page, locator, desired),
    () => nativeReactSetAndVerify(locator, desired),
    () => typeAndVerify(page, locator, desired)
  ];

  for (const strategy of strategies) {
    if (await strategy().catch(() => false)) {
      await locator.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true }))).catch(() => {});
      await wait(120);
      if (norm(await readValue(locator)) === norm(desired)) return true;
    }
  }

  const finalInfo = await targetInfo(locator);
  const finalValue = await readValue(locator);
  throw new Error(`Redbubble Description would not accept text. Target=${finalInfo?.tag || 'unknown'}, maxLength=${finalInfo?.maxLength ?? 'unknown'}, focused=${Boolean(finalInfo?.focused)}, storedLength=${String(finalValue || '').length}, desiredLength=${desired.length}.`);
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsWithVerifiedDescriptionPaste(page, metadata) {
  try {
    return await previousFillListingFields.call(this, page, metadata);
  } catch (error) {
    const message = String(error?.message || '');
    if (!/Description/i.test(message)) throw error;
  }
  return writeDescription(page, metadata.description);
};

module.exports = { writeDescription };
