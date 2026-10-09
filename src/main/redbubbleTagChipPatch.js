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

async function clearChips(box) {
  if (!box) return;
  for (let round = 0; round < 24; round += 1) {
    const button = box.locator('button, [role="button"]').filter({ has: box.page().locator('svg, span') }).last();
    const count = await box.locator('button, [role="button"]').count().catch(() => 0);
    if (!count) break;

    let removed = false;
    for (let i = count - 1; i >= 0; i -= 1) {
      const candidate = box.locator('button, [role="button"]').nth(i);
      const info = await candidate.evaluate((el) => ({
        text: String(el.innerText || el.textContent || '').trim(),
        aria: String(el.getAttribute('aria-label') || ''),
        title: String(el.getAttribute('title') || '')
      })).catch(() => null);
      if (!info) continue;
      if (/^(×|x|✕|✖)$/i.test(info.text) || /\b(remove|delete|clear)\b/i.test(`${info.aria} ${info.title}`)) {
        await candidate.click({ force: true, timeout: 1200 }).catch(() => {});
        await wait(70);
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
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

async function setTags(page, labelText, nextLabelText, tags) {
  let box = await markTagSection(page, labelText, nextLabelText);
  if (!box) return false;
  await box.scrollIntoViewIfNeeded().catch(() => {});
  await clearChips(box);
  await wait(120);

  for (const raw of tags) {
    const tag = norm(raw);
    if (!tag) continue;

    // React can recreate the box/editor after every committed chip.
    box = await markTagSection(page, labelText, nextLabelText) || box;
    const editor = await focusChipEditor(page, box);
    if (!editor) return false;

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
  return true;
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

  if (!(await setTags(page, 'Main Tag', 'Supporting Tags', [metadata.mainTag]))) {
    throw new Error('Redbubble Main Tag chip box could not be edited.');
  }
  if (!(await setTags(page, 'Supporting Tags', 'Description', supporting))) {
    throw new Error('Redbubble Supporting Tags chip box could not be edited.');
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
