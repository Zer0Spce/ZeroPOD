const { RedbubbleController } = require('./redbubbleController');
const { editorHasMetadataFields } = require('./redbubbleEditorFieldsPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function visibleControlNearLabel(page, labelText, selector) {
  const index = await page.evaluate(({ wantedLabel, wantedSelector }) => {
    const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };

    const labels = [...document.querySelectorAll('body *')]
      .filter(visible)
      .filter((el) => normalizeText(el.innerText || el.textContent) === wantedLabel)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });

    const label = labels[0];
    if (!label) return -1;
    const lr = label.getBoundingClientRect();
    const controls = [...document.querySelectorAll(wantedSelector)];

    const candidates = controls
      .map((el, index) => ({ el, index }))
      .filter(({ el }) => visible(el) && !el.disabled)
      .map(({ el, index }) => {
        const r = el.getBoundingClientRect();
        const vertical = r.top >= lr.top - 8 ? Math.max(0, r.top - lr.bottom) : 10000;
        const horizontalOverlap = Math.max(0, Math.min(r.right, lr.right + 800) - Math.max(r.left, lr.left - 40));
        const horizontalPenalty = horizontalOverlap > 0 ? 0 : Math.abs(r.left - lr.left);
        const tooFar = r.top > lr.bottom + 360 ? 10000 : 0;
        return { index, score: vertical + horizontalPenalty + tooFar };
      })
      .sort((a, b) => a.score - b.score);

    return candidates.length && candidates[0].score < 10000 ? candidates[0].index : -1;
  }, { wantedLabel: labelText, wantedSelector: selector }).catch(() => -1);

  if (index < 0) return null;
  return page.locator(selector).nth(index);
}

async function findTitleInput(page) {
  const allInputs = page.locator('input');
  const copiedIndex = await allInputs.evaluateAll((inputs) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    return inputs.findIndex((el) => visible(el) && !el.disabled && /^Copy of\s+/i.test(String(el.value || '').trim()));
  }).catch(() => -1);

  if (copiedIndex >= 0) return allInputs.nth(copiedIndex);

  const nearLabel = await visibleControlNearLabel(page, 'Title (required)', 'input');
  if (nearLabel) return nearLabel;

  const textInputs = page.locator('input[type="text"], input:not([type])');
  const firstVisible = await textInputs.evaluateAll((inputs) => inputs.findIndex((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return !el.disabled && r.width > 180 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden';
  })).catch(() => -1);

  return firstVisible >= 0 ? textInputs.nth(firstVisible) : null;
}

async function setReactValue(control, value) {
  if (!control) return false;
  const desired = String(value ?? '');
  await control.scrollIntoViewIfNeeded().catch(() => {});

  // Normal Playwright fill first: this is the least invasive and fires input events.
  try {
    await control.click({ timeout: 1800 });
    await control.fill(desired, { timeout: 2500 });
    await control.press('Tab').catch(() => {});
    await wait(180);
    if ((await control.inputValue().catch(() => '')) === desired) return true;
  } catch {}

  // React-compatible native value setter + input/change events.
  const nativeSet = await control.evaluate((element, nextValue) => {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) return false;
    element.focus();
    setter.call(element, nextValue);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
    return true;
  }, desired).catch(() => false);

  if (nativeSet) {
    await wait(220);
    if ((await control.inputValue().catch(() => '')) === desired) return true;
  }

  // Final keyboard fallback for editors that only commit trusted key events.
  try {
    await control.focus();
    await control.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await control.type(desired, { delay: 2 });
    await control.press('Tab').catch(() => {});
    await wait(220);
    return (await control.inputValue().catch(() => '')) === desired;
  } catch {
    return false;
  }
}

async function clearChipInput(input, maxChips = 24) {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.focus().catch(() => {});
  await input.fill('').catch(() => {});
  for (let i = 0; i < maxChips; i += 1) {
    await input.press('Backspace').catch(() => {});
    await wait(28);
  }
}

async function setChipTags(input, tags) {
  if (!input) return false;
  await clearChipInput(input);
  for (const raw of tags) {
    const tag = normalize(raw);
    if (!tag) continue;
    await input.focus().catch(() => {});
    await input.fill(tag).catch(async () => {
      await input.type(tag, { delay: 2 }).catch(() => {});
    });
    await input.press('Enter').catch(() => {});
    await wait(75);
  }
  return true;
}

async function sectionText(page, startLabel, endLabel) {
  return page.evaluate(({ startLabel, endLabel }) => {
    const norm = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const start = nodes.find((el) => norm(el.innerText || el.textContent) === startLabel);
    if (!start) return '';
    const startY = start.getBoundingClientRect().bottom;
    const end = nodes.find((el) => norm(el.innerText || el.textContent) === endLabel && el.getBoundingClientRect().top > startY);
    const endY = end ? end.getBoundingClientRect().top : Infinity;
    return nodes
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= startY && r.bottom <= endY;
      })
      .map((el) => norm(el.innerText || el.textContent))
      .filter(Boolean)
      .join(' ');
  }, { startLabel, endLabel }).catch(() => '');
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsForCurrentRedbubble(page, metadata) {
  if (!(await editorHasMetadataFields(page))) {
    throw new Error('Redbubble copied-work metadata editor is not ready.');
  }

  const titleInput = await findTitleInput(page);
  if (!titleInput) {
    throw new Error('Redbubble Title input was not found in the current copied-work editor.');
  }
  if (!(await setReactValue(titleInput, metadata.title))) {
    const current = await titleInput.inputValue().catch(() => '');
    throw new Error(`Redbubble Title field could not be updated. Current value: ${JSON.stringify(current).slice(0, 160)}`);
  }

  const mainInput = await visibleControlNearLabel(page, 'Main Tag', 'input');
  if (!mainInput) throw new Error('Redbubble Main Tag chip input was not found.');
  await setChipTags(mainInput, [metadata.mainTag]);

  const supporting = Array.isArray(metadata.supportingTags)
    ? metadata.supportingTags.map(normalize).filter(Boolean).slice(0, 14)
    : [];
  if (supporting.length !== 14) {
    throw new Error(`ZeroPOD metadata has ${supporting.length} Supporting Tags; Redbubble requires exactly 14 for this workflow.`);
  }

  const supportingInput = await visibleControlNearLabel(page, 'Supporting Tags', 'input');
  if (!supportingInput) throw new Error('Redbubble Supporting Tags chip input was not found.');
  await setChipTags(supportingInput, supporting);

  const description = await visibleControlNearLabel(page, 'Description', 'textarea')
    || page.locator('textarea').last();
  if (!description || !(await setReactValue(description, metadata.description))) {
    throw new Error('Redbubble Description field could not be updated.');
  }

  await wait(250);
  const titleValue = normalize(await titleInput.inputValue().catch(() => ''));
  const descriptionValue = normalize(await description.inputValue().catch(() => ''));
  if (titleValue !== normalize(metadata.title)) {
    throw new Error(`Redbubble Title reverted after entry. Current value: ${JSON.stringify(titleValue).slice(0, 160)}`);
  }
  if (descriptionValue !== normalize(metadata.description)) {
    throw new Error('Redbubble Description reverted after entry; editor update was not accepted.');
  }

  const mainText = (await sectionText(page, 'Main Tag', 'Supporting Tags')).toLowerCase();
  const supportText = (await sectionText(page, 'Supporting Tags', 'Description')).toLowerCase();
  if (metadata.mainTag && !mainText.includes(normalize(metadata.mainTag).toLowerCase())) {
    throw new Error(`Redbubble Main Tag did not persist after entry: ${metadata.mainTag}`);
  }
  const missing = supporting.filter((tag) => !supportText.includes(tag.toLowerCase()));
  if (missing.length) {
    throw new Error(`Redbubble Supporting Tags did not persist: ${missing.slice(0, 5).join(', ')}`);
  }

  return true;
};

module.exports = {};
