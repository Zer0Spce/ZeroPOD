const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousFillListingFields = RedbubbleController.prototype.fillListingFields;

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function markTagSection(page, labelText, nextLabelText) {
  const result = await page.evaluate(({ labelText, nextLabelText }) => {
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

    const inSection = (el) => {
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.top >= lr.bottom - 4 && r.bottom <= bottom + 8 && r.right >= lr.left - 80 && r.left <= lr.left + 900;
    };

    // Prefer the bordered chip box, not the explanatory text above it.
    const boxes = [...document.querySelectorAll('div, section, fieldset')]
      .filter(inSection)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const border = ['Top', 'Right', 'Bottom', 'Left'].reduce((sum, side) => sum + (parseFloat(s[`border${side}Width`]) || 0), 0);
        const chipish = !!el.querySelector('button, [role="button"], input, [role="combobox"], [role="textbox"], [contenteditable="true"]');
        return { el, r, border, chipish };
      })
      .filter(({ r }) => r.width >= 180 && r.height >= 42 && r.height <= 300)
      .filter(({ border, chipish }) => border > 0 || chipish)
      .sort((a, b) => {
        const as = (a.border > 0 ? -300 : 0) + (a.chipish ? -180 : 0) + Math.max(0, a.r.top - lr.bottom) + a.r.height * 0.1;
        const bs = (b.border > 0 ? -300 : 0) + (b.chipish ? -180 : 0) + Math.max(0, b.r.top - lr.bottom) + b.r.height * 0.1;
        return as - bs;
      });

    if (!boxes.length) return null;
    const token = `zeropod-tagbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    boxes[0].el.setAttribute('data-zeropod-tagbox', token);
    return token;
  }, { labelText, nextLabelText }).catch(() => null);

  return result ? page.locator(`[data-zeropod-tagbox="${result}"]`).first() : null;
}

async function tagBoxState(box) {
  if (!box) return { empty: false, text: '', buttonCount: -1, removeCount: -1 };
  return box.evaluate((el) => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const r = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };

    const buttons = [...el.querySelectorAll('button, [role="button"]')].filter(visible);
    const removeButtons = buttons.filter((button) => {
      const text = String(button.innerText || button.textContent || '').trim();
      const aria = String(button.getAttribute('aria-label') || '').trim();
      const title = String(button.getAttribute('title') || '').trim();
      return /^(×|x|✕|✖)$/i.test(text)
        || /\b(remove|delete|clear)\b/i.test(`${aria} ${title}`)
        || /[×✕✖]\s*$/i.test(text);
    });

    // Redbubble's empty chip box has no visible text. Chip labels contribute to
    // innerText, while input placeholders do not. Strip only common remove glyphs.
    const text = String(el.innerText || el.textContent || '')
      .replace(/[×✕✖]/g, ' ')
      .replace(/(^|\s)x(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      empty: text.length === 0 && removeButtons.length === 0 && buttons.length === 0,
      text,
      buttonCount: buttons.length,
      removeCount: removeButtons.length
    };
  }).catch(() => ({ empty: false, text: '', buttonCount: -1, removeCount: -1 }));
}

async function focusChipEditor(page, box) {
  if (!box) return null;

  let editor = box.locator('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), [role="combobox"], [role="textbox"], [contenteditable="true"]').last();
  if (await editor.count().catch(() => 0)) {
    await editor.focus().catch(() => {});
    return editor;
  }

  const rect = await box.boundingBox().catch(() => null);
  if (!rect) return null;
  // Click empty space inside the actual bordered tag box. This avoids selecting
  // Redbubble's nearby “Learn more about writing good tags” help copy.
  await page.mouse.click(rect.x + Math.max(18, rect.width - 18), rect.y + Math.max(18, rect.height - 18));
  await wait(100);

  editor = box.locator('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), [role="combobox"], [role="textbox"], [contenteditable="true"]').last();
  if (await editor.count().catch(() => 0)) {
    await editor.focus().catch(() => {});
    return editor;
  }

  return null;
}

async function clearChipsByBackspace(page, labelText, nextLabelText) {
  // Redbubble removes the previous chip when Backspace is pressed while the chip
  // editor is focused and empty. React recreates the editor after removals, so
  // periodically reacquire both the box and the editor.
  for (let pass = 0; pass < 3; pass += 1) {
    let box = await markTagSection(page, labelText, nextLabelText);
    if (!box) return { ok: false, reason: 'tag box not found' };
    await box.scrollIntoViewIfNeeded().catch(() => {});

    let state = await tagBoxState(box);
    if (state.empty) return { ok: true, state };

    let editor = await focusChipEditor(page, box);
    if (!editor) {
      const rect = await box.boundingBox().catch(() => null);
      if (!rect) return { ok: false, reason: 'chip editor could not be focused', state };
      await page.mouse.click(rect.x + Math.max(16, rect.width - 16), rect.y + Math.max(16, rect.height - 16));
      await wait(80);
    } else {
      const tagName = await editor.evaluate((el) => el.tagName).catch(() => '');
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
        await editor.fill('').catch(() => {});
      } else {
        await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
        await editor.press('Backspace').catch(() => {});
      }
    }

    // More than enough for Redbubble's maximum 15 chips. Extra presses are safe
    // because the editor is empty; they simply become no-ops after the last chip.
    for (let press = 0; press < 64; press += 1) {
      await page.keyboard.press('Backspace').catch(() => {});
      await wait(32);

      if ((press + 1) % 4 === 0) {
        box = await markTagSection(page, labelText, nextLabelText) || box;
        state = await tagBoxState(box);
        if (state.empty) return { ok: true, state };

        // Re-focus after React rebuilt the chip list/editor.
        editor = await focusChipEditor(page, box);
        if (editor) {
          const tagName = await editor.evaluate((el) => el.tagName).catch(() => '');
          if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
            await editor.fill('').catch(() => {});
          }
        }
      }
    }

    box = await markTagSection(page, labelText, nextLabelText) || box;
    state = await tagBoxState(box);
    if (state.empty) return { ok: true, state };

    // Give the next pass a fresh click/focus in case Redbubble swallowed a key.
    const rect = await box.boundingBox().catch(() => null);
    if (rect) {
      await page.mouse.click(rect.x + Math.max(16, rect.width - 16), rect.y + Math.max(16, rect.height - 16));
      await wait(120);
    }
  }

  const finalBox = await markTagSection(page, labelText, nextLabelText);
  const finalState = await tagBoxState(finalBox);
  return {
    ok: finalState.empty,
    state: finalState,
    reason: finalState.empty
      ? ''
      : `copied tags remain (text=${JSON.stringify(finalState.text).slice(0, 180)}, buttons=${finalState.buttonCount}, removeControls=${finalState.removeCount})`
  };
}

async function setTags(page, labelText, nextLabelText, tags) {
  let box = await markTagSection(page, labelText, nextLabelText);
  if (!box) return { ok: false, reason: 'tag box not found' };
  await box.scrollIntoViewIfNeeded().catch(() => {});

  const cleared = await clearChipsByBackspace(page, labelText, nextLabelText);
  if (!cleared.ok) return cleared;

  // Hard gate: do not type a single replacement tag until the copied chips have
  // been independently confirmed gone.
  box = await markTagSection(page, labelText, nextLabelText) || box;
  const emptyCheck = await tagBoxState(box);
  if (!emptyCheck.empty) {
    return {
      ok: false,
      reason: `tag clear verification failed before typing (text=${JSON.stringify(emptyCheck.text).slice(0, 180)}, buttons=${emptyCheck.buttonCount})`
    };
  }

  for (const raw of tags) {
    const tag = norm(raw);
    if (!tag) continue;

    // React can recreate the box/editor after every committed chip.
    box = await markTagSection(page, labelText, nextLabelText) || box;
    const editor = await focusChipEditor(page, box);
    if (!editor) return { ok: false, reason: `chip editor disappeared while entering ${tag}` };

    const tagName = await editor.evaluate((el) => el.tagName).catch(() => '');
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      await editor.fill('').catch(() => {});
      await editor.fill(tag).catch(async () => page.keyboard.type(tag, { delay: 2 }));
    } else {
      await page.keyboard.type(tag, { delay: 2 });
    }
    await editor.press('Enter').catch(async () => page.keyboard.press('Enter'));
    await wait(110);
  }
  return { ok: true };
}

async function sectionText(page, startLabel, endLabel) {
  return page.evaluate(({ startLabel, endLabel }) => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const start = nodes.find((el) => tidy(el.innerText || el.textContent) === startLabel);
    if (!start) return '';
    const sy = start.getBoundingClientRect().bottom;
    const end = nodes.find((el) => tidy(el.innerText || el.textContent) === endLabel && el.getBoundingClientRect().top > sy);
    const ey = end ? end.getBoundingClientRect().top : Infinity;
    return nodes.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= sy && r.bottom <= ey;
    }).map((el) => tidy(el.innerText || el.textContent)).filter(Boolean).join(' ');
  }, { startLabel, endLabel }).catch(() => '');
}

async function setDescription(page, value) {
  const textarea = page.locator('textarea').last();
  if (!(await textarea.count().catch(() => 0))) return false;
  await textarea.scrollIntoViewIfNeeded().catch(() => {});
  await textarea.fill(String(value || '')).catch(() => {});
  await textarea.press('Tab').catch(() => {});
  await wait(180);
  return norm(await textarea.inputValue().catch(() => '')) === norm(value);
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsWithTagChipFallback(page, metadata) {
  try {
    return await previousFillListingFields.call(this, page, metadata);
  } catch (error) {
    // Hotfix 27 already updates Title correctly. Take over only when the old tag
    // lookup fails, leaving image replacement and Title untouched.
    if (!/Main Tag chip input was not found|Supporting Tags chip input was not found/i.test(String(error?.message || ''))) {
      throw error;
    }
  }

  const supporting = Array.isArray(metadata.supportingTags)
    ? metadata.supportingTags.map(norm).filter(Boolean).slice(0, 14)
    : [];
  if (supporting.length !== 14) {
    throw new Error(`ZeroPOD metadata has ${supporting.length} Supporting Tags; expected exactly 14.`);
  }

  const mainResult = await setTags(page, 'Main Tag', 'Supporting Tags', [metadata.mainTag]);
  if (!mainResult.ok) {
    throw new Error(`Redbubble Main Tag could not be cleared/edited: ${mainResult.reason || 'unknown tag editor error'}.`);
  }

  const supportingResult = await setTags(page, 'Supporting Tags', 'Description', supporting);
  if (!supportingResult.ok) {
    throw new Error(`Redbubble Supporting Tags could not be cleared/edited: ${supportingResult.reason || 'unknown tag editor error'}.`);
  }

  if (!(await setDescription(page, metadata.description))) {
    throw new Error('Redbubble Description field could not be updated after tag entry.');
  }

  await wait(300);
  const mainText = (await sectionText(page, 'Main Tag', 'Supporting Tags')).toLowerCase();
  const supportText = (await sectionText(page, 'Supporting Tags', 'Description')).toLowerCase();
  if (metadata.mainTag && !mainText.includes(norm(metadata.mainTag).toLowerCase())) {
    throw new Error(`Redbubble Main Tag did not persist after entry: ${metadata.mainTag}`);
  }
  const missing = supporting.filter((tag) => !supportText.includes(tag.toLowerCase()));
  if (missing.length) {
    throw new Error(`Redbubble Supporting Tags did not persist: ${missing.slice(0, 5).join(', ')}`);
  }

  return true;
};

module.exports = {};
