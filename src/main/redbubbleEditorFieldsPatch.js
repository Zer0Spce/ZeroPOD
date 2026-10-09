const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function editorHasMetadataFields(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const hasTitle = /Title\s*\(required\)/i.test(text);
    const hasMain = /\bMain Tag\b/i.test(text);
    const hasSupporting = /\bSupporting Tags\b/i.test(text);
    const hasDescription = /\bDescription\b/i.test(text);
    return hasTitle && hasMain && hasSupporting && hasDescription;
  }).catch(() => false);
}

async function visibleBusy(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };

    const busy = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(visible);
    const body = document.body?.innerText || '';
    const textBusy = /uploading|processing image|replacing image|preparing image|please wait/i.test(body);
    return busy || textBusy;
  }).catch(() => false);
}

// Redbubble can remove/hide Replace all images after a successful replacement.
// Do not use that button reappearing as the success signal. The copied-work editor
// being stable again is sufficient to continue to the metadata fields.
RedbubbleController.prototype.waitForArtworkUpload = async function waitForArtworkUploadCurrent(page, timeoutMs = 120000) {
  const started = Date.now();
  let stableSince = null;

  while (Date.now() - started < timeoutMs) {
    const busy = await visibleBusy(page);
    const fieldsReady = await editorHasMetadataFields(page);

    if (!busy && fieldsReady) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 1800) return true;
    } else {
      stableSince = null;
    }

    await wait(180);
  }

  throw new Error('Redbubble replacement artwork did not return to a stable copied-work editor before timeout.');
};

async function exactText(page, regex) {
  const locator = page.getByText(regex, { exact: true }).last();
  if (await locator.isVisible().catch(() => false)) return locator;
  return null;
}

async function nextControlAfterLabel(page, labelRegex, selector) {
  const label = await exactText(page, labelRegex);
  if (!label) return null;

  const control = label.locator(`xpath=following::${selector}[1]`);
  if (!(await control.count().catch(() => 0))) return null;
  return control;
}

async function forceValue(control, value) {
  if (!control) return false;
  const stringValue = String(value ?? '');

  await control.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await control.fill(stringValue, { timeout: 2500 });
  } catch {
    try {
      await control.focus();
      await control.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await control.type(stringValue, { delay: 1 });
    } catch {
      return false;
    }
  }

  // React-controlled inputs sometimes restore their old value after a plain fill.
  // Verify after a render tick; if necessary use the native setter and input/change.
  await wait(120);
  const current = await control.inputValue().catch(() => null);
  if (current === stringValue) return true;

  return control.evaluate((element, desired) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) return false;
    setter.call(element, desired);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element.value === desired;
  }, stringValue).catch(() => false);
}

async function tagInputAfterLabel(page, labelRegex) {
  const label = await exactText(page, labelRegex);
  if (!label) return null;

  // Redbubble currently uses chip/tag controls containing a real input. Prefer the
  // first input after the field heading, which keeps Main Tag and Supporting Tags
  // separated even though both controls use the same component.
  const input = label.locator('xpath=following::input[1]');
  if (!(await input.count().catch(() => 0))) return null;
  return input;
}

async function clearChipControl(page, input, maxChips = 20) {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.focus().catch(() => {});

  // Ensure any typed search text is empty first.
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await input.press('Backspace').catch(() => {});

  // React Select-style tag widgets remove the final chip on Backspace when the
  // text input is empty. This is more reliable than trying to identify the tiny X
  // icon inside each Redbubble chip.
  for (let i = 0; i < maxChips; i += 1) {
    await input.press('Backspace').catch(() => {});
    await wait(35);
  }
}

async function enterChipTags(page, input, tags) {
  if (!input) return false;
  await clearChipControl(page, input, 22);

  for (const raw of tags) {
    const tag = String(raw || '').trim();
    if (!tag) continue;
    await input.focus().catch(() => {});
    await input.fill(tag).catch(async () => {
      await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
      await input.type(tag, { delay: 1 });
    });
    await input.press('Enter');
    await wait(80);
  }

  return true;
}

async function visibleSectionText(page, startRegex, endRegex = null) {
  return page.evaluate(({ startSource, startFlags, endSource, endFlags }) => {
    const startRe = new RegExp(startSource, startFlags);
    const endRe = endSource ? new RegExp(endSource, endFlags) : null;
    const nodes = [...document.querySelectorAll('body *')].filter((el) => {
      const text = String(el.textContent || '').trim();
      if (!text || !startRe.test(text)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const start = nodes[nodes.length - 1];
    if (!start) return '';
    const top = start.getBoundingClientRect().bottom;
    let bottom = Infinity;
    if (endRe) {
      const end = [...document.querySelectorAll('body *')].find((el) => {
        const text = String(el.textContent || '').trim();
        if (!endRe.test(text)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top > top;
      });
      if (end) bottom = end.getBoundingClientRect().top;
    }
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= top && r.bottom <= bottom;
      })
      .map((el) => String(el.textContent || '').trim())
      .filter(Boolean)
      .join(' ');
  }, {
    startSource: startRegex.source,
    startFlags: startRegex.flags,
    endSource: endRegex?.source || '',
    endFlags: endRegex?.flags || ''
  }).catch(() => '');
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsCurrent(page, metadata) {
  if (!(await editorHasMetadataFields(page))) {
    throw new Error('Redbubble copied-work metadata editor is not ready.');
  }

  // Title: use the visible current Redbubble heading instead of name/id attributes.
  const titleInput = await nextControlAfterLabel(page, /^Title \(required\)$/i, 'input');
  if (!titleInput || !(await forceValue(titleInput, metadata.title))) {
    throw new Error('Redbubble Title field could not be updated.');
  }

  const mainInput = await tagInputAfterLabel(page, /^Main Tag$/i);
  if (!mainInput) throw new Error('Redbubble Main Tag chip input was not found.');
  await enterChipTags(page, mainInput, [metadata.mainTag]);

  const supporting = Array.isArray(metadata.supportingTags)
    ? metadata.supportingTags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 14)
    : [];
  if (supporting.length !== 14) {
    throw new Error(`ZeroPOD metadata has ${supporting.length} Supporting Tags; Redbubble requires exactly 14 for this workflow.`);
  }

  const supportingInput = await tagInputAfterLabel(page, /^Supporting Tags$/i);
  if (!supportingInput) throw new Error('Redbubble Supporting Tags chip input was not found.');
  await enterChipTags(page, supportingInput, supporting);

  const description = await nextControlAfterLabel(page, /^Description$/i, 'textarea');
    || page.locator('textarea[placeholder*="drawing" i], textarea').last();
  if (!description || !(await forceValue(description, metadata.description))) {
    throw new Error('Redbubble Description field could not be updated.');
  }

  // Verify the title/description values and that the new tag text is present before
  // allowing ZeroPOD to advance to Final Review.
  const titleValue = await titleInput.inputValue().catch(() => '');
  const descriptionValue = await description.inputValue().catch(() => '');
  if (titleValue.trim() !== String(metadata.title).trim()) {
    throw new Error('Redbubble Title reverted after entry; editor update was not accepted.');
  }
  if (descriptionValue.trim() !== String(metadata.description).trim()) {
    throw new Error('Redbubble Description reverted after entry; editor update was not accepted.');
  }

  const mainText = await visibleSectionText(page, /^Main Tag$/i, /^Supporting Tags$/i);
  const supportText = await visibleSectionText(page, /^Supporting Tags$/i, /^Description$/i);
  if (metadata.mainTag && !mainText.toLowerCase().includes(String(metadata.mainTag).toLowerCase())) {
    throw new Error('Redbubble Main Tag did not persist after entry.');
  }
  const missing = supporting.filter((tag) => !supportText.toLowerCase().includes(tag.toLowerCase()));
  if (missing.length) {
    throw new Error(`Redbubble Supporting Tags did not persist: ${missing.slice(0, 4).join(', ')}`);
  }

  return true;
};

module.exports = { editorHasMetadataFields };
