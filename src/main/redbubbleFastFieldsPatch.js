const { RedbubbleController } = require('./redbubbleController');
const { performanceMetrics } = require('./performanceMetrics');

const previousFillListingFields = RedbubbleController.prototype.fillListingFields;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tagPresent(text, tag) {
  const wanted = norm(tag).toLowerCase();
  if (!wanted) return false;
  const escaped = escapeRegex(wanted);
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(String(text || '').toLowerCase());
}

async function waitUntil(predicate, timeoutMs = 900, intervalMs = 20) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate().catch(() => false)) return true;
    await wait(intervalMs);
  }
  return false;
}

async function fastEditorReady(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText || '';
    const visibleInput = [...document.querySelectorAll('input')].some((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 160 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden' && !el.disabled;
    });
    return visibleInput && /Main Tag/i.test(body) && /Supporting Tags/i.test(body);
  }).catch(() => false);
}

async function findTitleInput(page) {
  const inputs = page.locator('input');
  const index = await inputs.evaluateAll((elements) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 160 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden' && !el.disabled;
    };

    let best = null;
    elements.forEach((el, index) => {
      if (!visible(el)) return;
      const value = String(el.value || '').trim();
      const identity = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`;
      let score = 0;
      if (/^Copy of\s+/i.test(value)) score += 1000;
      if (/title/i.test(identity)) score += 700;
      if ((el.type || 'text') === 'text') score += 80;
      const r = el.getBoundingClientRect();
      score += Math.max(0, 300 - r.top * 0.1);
      if (!best || score > best.score) best = { index, score };
    });
    return best?.index ?? -1;
  }).catch(() => -1);

  return index >= 0 ? inputs.nth(index) : null;
}

async function setTitleFast(page, value) {
  const input = await findTitleInput(page);
  if (!input) throw new Error('Fast Redbubble title input was not found.');
  const desired = String(value || '').trim();
  if (!desired) throw new Error('Redbubble title is empty.');

  if (norm(await input.inputValue().catch(() => '')) === norm(desired)) return true;

  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.fill(desired, { timeout: 2500 }).catch(() => {});
  await input.evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  await input.press('Tab').catch(() => {});

  const accepted = await waitUntil(async () => norm(await input.inputValue().catch(() => '')) === norm(desired), 1000, 20);
  if (!accepted) throw new Error('Fast Redbubble title update did not persist.');
  return true;
}

async function markTagSection(page, labelText, nextLabelText) {
  const token = await page.evaluate(({ labelText, nextLabelText }) => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };

    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const label = nodes.find((el) => tidy(el.innerText || el.textContent) === labelText);
    if (!label) return null;
    const lr = label.getBoundingClientRect();
    const next = nodes.find((el) => tidy(el.innerText || el.textContent) === nextLabelText && el.getBoundingClientRect().top > lr.bottom);
    const bottom = next ? next.getBoundingClientRect().top : lr.bottom + 520;

    const candidates = [...document.querySelectorAll('div, section, fieldset')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect(), s: getComputedStyle(el) }))
      .filter(({ r }) => r.top >= lr.bottom - 4 && r.bottom <= bottom + 8 && r.width >= 180 && r.height >= 38 && r.height <= 320)
      .map(({ el, r, s }) => {
        const border = ['Top', 'Right', 'Bottom', 'Left'].reduce((sum, side) => sum + (parseFloat(s[`border${side}Width`]) || 0), 0);
        const controls = el.querySelectorAll('button, [role="button"], input, [role="combobox"], [role="textbox"], [contenteditable="true"]').length;
        const score = (border > 0 ? 600 : 0) + controls * 70 - Math.max(0, r.top - lr.bottom) * 2 - r.height * 0.04;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) return null;
    const marker = `zeropod-fast-tags-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    candidates[0].el.setAttribute('data-zeropod-fast-tags', marker);
    return marker;
  }, { labelText, nextLabelText }).catch(() => null);

  return token ? page.locator(`[data-zeropod-fast-tags="${token}"]`).first() : null;
}

async function tagSectionState(page, labelText, nextLabelText) {
  const box = await markTagSection(page, labelText, nextLabelText);
  if (!box) return { box: null, text: '', removeCount: 0, buttonCount: 0, empty: false };
  const state = await box.evaluate((el) => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const r = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const buttons = [...el.querySelectorAll('button, [role="button"]')].filter(visible);
    const isRemove = (button) => {
      const text = String(button.innerText || button.textContent || '').trim();
      const aria = String(button.getAttribute('aria-label') || '').trim();
      const title = String(button.getAttribute('title') || '').trim();
      return /^(×|x|✕|✖)$/i.test(text)
        || /\b(remove|delete|clear)\b/i.test(`${aria} ${title}`)
        || /[×✕✖]\s*$/i.test(text);
    };
    const removeButtons = buttons.filter(isRemove);
    const text = String(el.innerText || el.textContent || '')
      .replace(/[×✕✖]/g, ' ')
      .replace(/(^|\s)x(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      text,
      removeCount: removeButtons.length,
      buttonCount: buttons.length,
      empty: !text && removeButtons.length === 0
    };
  }).catch(() => ({ text: '', removeCount: 0, buttonCount: 0, empty: false }));
  return { box, ...state };
}

async function firstRemoveButton(box) {
  const buttons = box.locator('button, [role="button"]');
  const index = await buttons.evaluateAll((elements) => {
    const visible = (node) => {
      const r = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    return elements.findIndex((button) => {
      if (!visible(button)) return false;
      const text = String(button.innerText || button.textContent || '').trim();
      const aria = String(button.getAttribute('aria-label') || '').trim();
      const title = String(button.getAttribute('title') || '').trim();
      return /^(×|x|✕|✖)$/i.test(text)
        || /\b(remove|delete|clear)\b/i.test(`${aria} ${title}`)
        || /[×✕✖]\s*$/i.test(text);
    });
  }).catch(() => -1);
  return index >= 0 ? buttons.nth(index) : null;
}

async function focusTagEditor(page, box) {
  let editor = box.locator('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), [role="combobox"], [role="textbox"], [contenteditable="true"]').last();
  if (await editor.count().catch(() => 0)) {
    await editor.focus().catch(() => {});
    return editor;
  }

  const rect = await box.boundingBox().catch(() => null);
  if (!rect) return null;
  await page.mouse.click(rect.x + Math.max(18, rect.width - 18), rect.y + Math.max(18, rect.height - 18)).catch(() => {});
  await wait(20);
  editor = box.locator('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), [role="combobox"], [role="textbox"], [contenteditable="true"]').last();
  if (!(await editor.count().catch(() => 0))) return null;
  await editor.focus().catch(() => {});
  return editor;
}

async function clearTagsFast(page, labelText, nextLabelText) {
  for (let pass = 0; pass < 28; pass += 1) {
    const before = await tagSectionState(page, labelText, nextLabelText);
    if (!before.box) throw new Error(`${labelText} tag box was not found.`);
    if (before.empty) return true;

    const remove = await firstRemoveButton(before.box);
    if (remove) {
      const fingerprint = `${before.text}|${before.removeCount}|${before.buttonCount}`;
      await remove.click({ force: true, timeout: 1000 }).catch(() => {});
      await waitUntil(async () => {
        const after = await tagSectionState(page, labelText, nextLabelText);
        return after.empty || `${after.text}|${after.removeCount}|${after.buttonCount}` !== fingerprint;
      }, 500, 15);
      continue;
    }

    const editor = await focusTagEditor(page, before.box);
    if (!editor) break;
    await editor.fill('').catch(() => {});
    const oldText = before.text;
    await editor.press('Backspace').catch(async () => page.keyboard.press('Backspace').catch(() => {}));
    await waitUntil(async () => {
      const after = await tagSectionState(page, labelText, nextLabelText);
      return after.empty || after.text !== oldText;
    }, 450, 15);
  }

  const finalState = await tagSectionState(page, labelText, nextLabelText);
  if (!finalState.empty) throw new Error(`${labelText} copied tags did not clear quickly.`);
  return true;
}

async function enterTag(page, labelText, nextLabelText, tag) {
  const desired = norm(tag);
  if (!desired) return false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = await tagSectionState(page, labelText, nextLabelText);
    if (!state.box) return false;
    if (tagPresent(state.text, desired)) return true;

    const editor = await focusTagEditor(page, state.box);
    if (!editor) return false;
    const tagName = await editor.evaluate((el) => el.tagName).catch(() => '');
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      await editor.fill('').catch(() => {});
      await editor.fill(desired).catch(async () => page.keyboard.insertText(desired).catch(() => {}));
    } else {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.insertText(desired).catch(() => {});
    }
    await editor.press('Enter').catch(async () => page.keyboard.press('Enter').catch(() => {}));

    const accepted = await waitUntil(async () => {
      const after = await tagSectionState(page, labelText, nextLabelText);
      return tagPresent(after.text, desired);
    }, 650, 20);
    if (accepted) return true;
  }
  return false;
}

async function setTagsFast(page, labelText, nextLabelText, tags, minimumAccepted) {
  const desired = tags.map(norm).filter(Boolean);
  await clearTagsFast(page, labelText, nextLabelText);

  for (const tag of desired) {
    await enterTag(page, labelText, nextLabelText, tag);
  }

  const finalState = await tagSectionState(page, labelText, nextLabelText);
  const accepted = desired.filter((tag) => tagPresent(finalState.text, tag));
  if (accepted.length < minimumAccepted) {
    throw new Error(`${labelText} fast path accepted ${accepted.length}/${desired.length} tags; need at least ${minimumAccepted}.`);
  }
  return accepted.length;
}

async function fillCurrentEditorFast(page, metadata) {
  if (!(await fastEditorReady(page))) throw new Error('Current Redbubble editor is not ready for fast field entry.');

  const supporting = Array.isArray(metadata.supportingTags)
    ? metadata.supportingTags.map(norm).filter(Boolean).slice(0, 14)
    : [];
  if (supporting.length !== 14) throw new Error(`ZeroPOD metadata has ${supporting.length} Supporting Tags; expected 14.`);

  await setTitleFast(page, metadata.title);
  const mainAccepted = await setTagsFast(page, 'Main Tag', 'Supporting Tags', [metadata.mainTag], 1);
  const supportAccepted = await setTagsFast(page, 'Supporting Tags', 'Description', supporting, 9);

  return { mainAccepted, supportAccepted };
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsFastFirst(page, metadata) {
  const started = Date.now();
  try {
    const result = await fillCurrentEditorFast(page, metadata);
    performanceMetrics.record('redbubble-fields-fast', Date.now() - started, 'success', result);
    console.warn(`[ZeroPOD] Redbubble fast fields: title + tags completed with ${result.supportAccepted} supporting tags.`);
    return true;
  } catch (error) {
    performanceMetrics.record('redbubble-fields-fast', Date.now() - started, 'fallback', { message: error.message || String(error) });
    console.warn(`[ZeroPOD] Redbubble fast fields fell back to proven reliability path: ${error.message || error}`);
    return previousFillListingFields.call(this, page, metadata);
  }
};

module.exports = { fillCurrentEditorFast, setTagsFast, clearTagsFast };
