const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousFillListingFields = RedbubbleController.prototype.fillListingFields;

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function visibleSectionText(page, startLabel, endLabel) {
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
    const ey = end ? end.getBoundingClientRect().top : sy + 700;
    return nodes
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= sy && r.bottom <= ey;
      })
      .map((el) => tidy(el.innerText || el.textContent))
      .filter(Boolean)
      .join(' ');
  }, { startLabel, endLabel }).catch(() => '');
}

async function acceptedSupportingCount(page) {
  return page.evaluate(() => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const start = nodes.find((el) => tidy(el.innerText || el.textContent) === 'Supporting Tags');
    const end = nodes.find((el) => tidy(el.innerText || el.textContent) === 'Description');
    if (!start || !end) return 0;
    const sy = start.getBoundingClientRect().bottom;
    const ey = end.getBoundingClientRect().top;
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((el) => {
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.top >= sy && r.bottom <= ey;
    });
    const labels = new Set();
    for (const button of buttons) {
      let text = tidy(button.innerText || button.textContent).replace(/[×✕✖]/g, '').trim();
      if (!text || /^(remove|delete|clear)$/i.test(text)) continue;
      if (/^[a-z0-9]+$/i.test(text)) labels.add(text.toLowerCase());
    }
    return labels.size;
  }).catch(() => 0);
}

async function currentTitle(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const candidate = inputs.find((el) => {
      const value = String(el.value || '').trim();
      const name = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`;
      return value && (/title/i.test(name) || value.length >= 8);
    });
    return candidate ? String(candidate.value || '') : '';
  }).catch(() => '');
}

async function listingCoreAlreadyPresent(page, metadata) {
  const title = norm(await currentTitle(page));
  if (!title || title !== norm(metadata.title)) return false;

  const mainText = norm(await visibleSectionText(page, 'Main Tag', 'Supporting Tags')).toLowerCase();
  const mainTag = norm(metadata.mainTag).toLowerCase();
  if (!mainTag || !mainText.includes(mainTag)) return false;

  const supportCount = await acceptedSupportingCount(page);
  return supportCount >= 9;
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
    const candidates = [...document.querySelectorAll('textarea')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top >= lr.bottom - 8 && r.top <= lr.bottom + 500)
      .sort((a, b) => {
        const ad = Math.abs(a.r.left - lr.left) + Math.max(0, a.r.top - lr.bottom) * 3;
        const bd = Math.abs(b.r.left - lr.left) + Math.max(0, b.r.top - lr.bottom) * 3;
        return ad - bd;
      });
    if (!candidates.length) return null;
    const token = `zeropod-description-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    candidates[0].el.setAttribute('data-zeropod-description-retry', token);
    return token;
  }).catch(() => null);

  return marker ? page.locator(`[data-zeropod-description-retry="${marker}"]`).first() : null;
}

async function verifyDescription(textarea, desired) {
  await wait(180);
  const actual = await textarea.inputValue().catch(() => '');
  return norm(actual) === norm(desired);
}

async function writeDescription(page, value) {
  const desired = String(value || '').trim();
  if (!desired) return false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const textarea = await locateDescription(page);
    if (!textarea || !(await textarea.count().catch(() => 0))) return false;

    await textarea.scrollIntoViewIfNeeded().catch(() => {});
    await textarea.click({ force: true }).catch(() => {});
    await wait(80);

    if (attempt === 0) {
      await textarea.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
      await textarea.press('Backspace').catch(() => {});
      await page.keyboard.insertText(desired).catch(() => {});
      await textarea.press('Tab').catch(() => page.keyboard.press('Tab'));
    } else if (attempt === 1) {
      await textarea.fill('').catch(() => {});
      await textarea.type(desired, { delay: 1 }).catch(async () => {
        await page.keyboard.insertText(desired).catch(() => {});
      });
      await textarea.press('Tab').catch(() => {});
    } else if (attempt === 2) {
      await textarea.evaluate((el, next) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, next);
        el.focus();
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }, desired).catch(() => {});
    } else {
      await textarea.click({ force: true }).catch(() => {});
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.type(desired, { delay: 2 }).catch(() => {});
      await page.keyboard.press('Tab').catch(() => {});
    }

    if (await verifyDescription(textarea, desired)) return true;
    await wait(220);
  }

  return false;
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsWithDescriptionOnlyRetry(page, metadata) {
  const coreAlreadyPresent = await listingCoreAlreadyPresent(page, metadata);

  if (!coreAlreadyPresent) {
    try {
      return await previousFillListingFields.call(this, page, metadata);
    } catch (error) {
      const message = String(error?.message || '');
      const descriptionOnly = /Description field could not be updated|Description-labelled textarea/i.test(message);
      if (!descriptionOnly) throw error;
    }
  }

  // If Title/Main Tag/Supporting Tags are already correct, do not rewrite them on
  // the controller's second retry. Retry only the Description field.
  if (!(await listingCoreAlreadyPresent(page, metadata))) {
    throw new Error('Redbubble listing core fields are not stable enough for Description-only retry.');
  }

  if (!(await writeDescription(page, metadata.description))) {
    throw new Error('Redbubble Description text did not persist after dedicated Description-only retries.');
  }

  return true;
};

module.exports = { writeDescription, listingCoreAlreadyPresent };
