const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousFillListingFields = RedbubbleController.prototype.fillListingFields;

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function sectionBounds(page, labelText, nextLabelText) {
  return page.evaluate(({ labelText, nextLabelText }) => {
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
    return {
      left: lr.left,
      right: lr.right,
      top: lr.bottom,
      bottom: next ? next.getBoundingClientRect().top : lr.bottom + 520
    };
  }, { labelText, nextLabelText }).catch(() => null);
}

async function findChipEditor(page, labelText, nextLabelText) {
  const bounds = await sectionBounds(page, labelText, nextLabelText);
  if (!bounds) return null;

  const result = await page.evaluate(({ bounds }) => {
    const styleVisible = (el) => {
      if (!(el instanceof Element)) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    };
    const inSection = (el) => {
      if (!styleVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.bottom >= bounds.top - 6
        && r.top <= bounds.bottom + 6
        && r.right >= bounds.left - 80
        && r.left <= bounds.left + 900;
    };

    // Redbubble's chip editor may be a tiny input, a combobox/textbox role, or
    // contenteditable. Do not require a normal-sized visible <input>.
    const controls = [...document.querySelectorAll('input, [role="combobox"], [role="textbox"], [contenteditable="true"]')]
      .filter(inSection)
      .filter((el) => !('disabled' in el) || !el.disabled)
      .filter((el) => {
        const type = String(el.getAttribute('type') || '').toLowerCase();
        return !['file', 'checkbox', 'radio', 'hidden'].includes(type);
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        const role = el.getAttribute('role') || '';
        const score = Math.max(0, r.top - bounds.top)
          + Math.min(500, Math.abs(r.left - bounds.left))
          - (/combobox|textbox/.test(role) ? 180 : 0)
          - (el.getAttribute('contenteditable') === 'true' ? 140 : 0);
        return { el, score };
      })
      .sort((a, b) => a.score - b.score);

    const token = `zeropod-chip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (controls.length) {
      controls[0].el.setAttribute('data-zeropod-chip-editor', token);
      return { token, mode: 'control' };
    }

    // Find the bordered chip box instead of nearby help text. Prefer containers
    // with a border and/or descendants that look like chips/remove buttons.
    const boxes = [...document.querySelectorAll('div, section, fieldset')]
      .filter(inSection)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const border = ['Top', 'Right', 'Bottom', 'Left']
          .reduce((sum, side) => sum + (parseFloat(s[`border${side}Width`]) || 0), 0);
        const chipish = el.querySelector('button, [role="button"], input, [role="combobox"], [contenteditable="true"]') ? 1 : 0;
        return { el, r, border, chipish };
      })
      .filter(({ r }) => r.width >= 180 && r.height >= 42 && r.top >= bounds.top - 4 && r.bottom <= bounds.bottom + 8)
      .filter(({ border, chipish }) => border > 0 || chipish)
      .sort((a, b) => {
        const aScore = (a.border > 0 ? -250 : 0) + (a.chipish ? -160 : 0) + a.r.height * 0.2 + Math.max(0, a.r.top - bounds.top);
        const bScore = (b.border > 0 ? -250 : 0) + (b.chipish ? -160 : 0) + b.r.height * 0.2 + Math.max(0, b.r.top - bounds.top);
        return aScore - bScore;
      });

    if (!boxes.length) return null;
    boxes[0].el.setAttribute('data-zeropod-chip-box', token);
    return { token, mode: 'box' };
  }, { bounds }).catch(() => null);

  if (!result) return null;
  const selector = result.mode === 'control'
    ? `[data-zeropod-chip-editor="${result.token}"]`
    : `[data-zeropod-chip-box="${result.token}"]`;
  return { locator: page.locator(selector).first(), mode: result.mode };
}

async function removeExistingChips(page, labelText, nextLabelText) {
  const bounds = await sectionBounds(page, labelText, nextLabelText);
  if (!bounds) return;

  // Re-scan after every click because React rebuilds the chip list.
  for (let round = 0; round < 24; round += 1) {
    const token = await page.evaluate(({ bounds }) => {
      const visible = (el) => {
        if (!(el instanceof Element)) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const candidate = [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= bounds.top - 8 && r.bottom <= bounds.bottom + 8 && r.right >= bounds.left - 80 && r.left <= bounds.left + 900;
        })
        .find((el) => {
          const text = String(el.innerText || el.textContent || '').trim();
          const aria = String(el.getAttribute('aria-label') || '').trim();
          const title = String(el.getAttribute('title') || '').trim();
          return /^(×|x|✕|✖)$/i.test(text)
            || /\b(remove|delete|clear)\b/i.test(`${aria} ${title}`);
        });
      if (!candidate) return null;
      const token = `zeropod-remove-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      candidate.setAttribute('data-zeropod-chip-remove', token);
      return token;
    }, { bounds }).catch(() => null);

    if (!token) break;
    const button = page.locator(`[data-zeropod-chip-remove="${token}"]`).first();
    if (!(await button.count().catch(() => 0))) break;
    await button.click({ force: true, timeout: 1200 }).catch(() => {});
    await wait(80);
  }
}

async function commitTag(page, labelText, nextLabelText, tag) {
  let editor = await findChipEditor(page, labelText, nextLabelText);
  if (!editor) return false;

  const target = editor.locator;
  await target.scrollIntoViewIfNeeded().catch(() => {});

  if (editor.mode === 'box') {
    const box = await target.boundingBox().catch(() => null);
    if (!box) return false;
    // Click bottom-right empty space of the chip box, never the instructional copy.
    await page.mouse.click(box.x + Math.max(20, box.width - 20), box.y + Math.max(20, box.height - 20));
    await wait(90);
    editor = await findChipEditor(page, labelText, nextLabelText) || editor;
  }

  if (editor.mode === 'control') {
    const control = editor.locator;
    await control.focus().catch(() => {});
    const tagName = await control.evaluate((el) => el.tagName).catch(() => '');
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      await control.fill('').catch(() => {});
      await control.fill(tag).catch(async () => page.keyboard.type(tag, { delay: 2 }));
    } else {
      await page.keyboard.type(tag, { delay: 2 });
    }
    await control.press('Enter').catch(async () => page.keyboard.press('Enter'));
  } else {
    await page.keyboard.type(tag, { delay: 2 });
    await page.keyboard.press('Enter');
  }

  await wait(120);
  return true;
}

async function setTagSection(page, labelText, nextLabelText, tags) {
  await removeExistingChips(page, labelText, nextLabelText);
  await wait(120);
  for (const raw of tags) {
    const tag = norm(raw);
    if (!tag) continue;
    if (!(await commitTag(page, labelText, nextLabelText, tag))) return false;
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

async function setDescription(page, description) {
  const textarea = page.locator('textarea').last();
  if (!(await textarea.count().catch(() => 0))) return false;
  await textarea.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await textarea.fill(String(description || ''));
    await textarea.press('Tab').catch(() => {});
    await wait(160);
    return norm(await textarea.inputValue().catch(() => '')) === norm(description);
  } catch {
    return false;
  }
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsWithCurrentTagChips(page, metadata) {
  try {
    return await previousFillListingFields.call(this, page, metadata);
  } catch (error) {
    // Hotfix 27 already updates Title successfully. Only take over when its old
    // visible-input assumption fails on Redbubble's chip editors.
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

  if (!(await setTagSection(page, 'Main Tag', 'Supporting Tags', [metadata.mainTag]))) {
    throw new Error('Redbubble Main Tag chip box could not be edited.');
  }
  if (!(await setTagSection(page, 'Supporting Tags', 'Description', supporting))) {
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
