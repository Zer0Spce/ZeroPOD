const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousFillListingFields = RedbubbleController.prototype.fillListingFields;

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function markSectionBox(page, labelText, nextLabelText) {
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
      .filter(({ r }) => r.top >= lr.bottom - 4 && r.bottom <= bottom + 8 && r.width >= 180 && r.height >= 42 && r.height <= 320)
      .map(({ el, r, s }) => {
        const border = ['Top', 'Right', 'Bottom', 'Left'].reduce((sum, side) => sum + (parseFloat(s[`border${side}Width`]) || 0), 0);
        const controls = el.querySelectorAll('button, [role="button"], input, [role="combobox"], [role="textbox"], [contenteditable="true"]').length;
        const score = (border > 0 ? 500 : 0) + controls * 50 - Math.max(0, r.top - lr.bottom) - r.height * 0.05;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) return null;
    const marker = `zeropod-accepted-tags-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    candidates[0].el.setAttribute('data-zeropod-accepted-tags', marker);
    return marker;
  }, { labelText, nextLabelText }).catch(() => null);

  return token ? page.locator(`[data-zeropod-accepted-tags="${token}"]`).first() : null;
}

async function acceptedChipState(page, labelText, nextLabelText) {
  const box = await markSectionBox(page, labelText, nextLabelText);
  if (!box) return { count: 0, text: '', labels: [] };

  return box.evaluate((el) => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const r = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const controls = [...el.querySelectorAll('button, [role="button"]')].filter(visible);
    const removeControls = controls.filter((button) => {
      const text = tidy(button.innerText || button.textContent);
      const aria = tidy(button.getAttribute('aria-label'));
      const title = tidy(button.getAttribute('title'));
      return /^(×|x|✕|✖)$/i.test(text)
        || /\b(remove|delete|clear)\b/i.test(`${aria} ${title}`)
        || /[×✕✖]\s*$/i.test(text);
    });

    const labels = [];
    for (const button of controls) {
      const text = tidy(button.innerText || button.textContent).replace(/[×✕✖]/g, '').trim();
      if (text && !/^(remove|delete|clear)$/i.test(text) && !labels.includes(text)) labels.push(text);
    }

    const text = tidy(el.innerText || el.textContent);
    return {
      count: removeControls.length || labels.length,
      text,
      labels
    };
  }).catch(() => ({ count: 0, text: '', labels: [] }));
}

async function setDescriptionByLabel(page, value) {
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
    const textarea = [...document.querySelectorAll('textarea')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top >= lr.bottom - 4)
      .sort((a, b) => (a.r.top - lr.bottom) - (b.r.top - lr.bottom))[0]?.el;
    if (!textarea) return null;
    const token = `zeropod-description-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    textarea.setAttribute('data-zeropod-description', token);
    return token;
  }).catch(() => null);

  if (!marker) return false;
  const textarea = page.locator(`[data-zeropod-description="${marker}"]`).first();
  await textarea.scrollIntoViewIfNeeded().catch(() => {});

  const desired = String(value || '');
  await textarea.fill(desired).catch(() => {});
  let actual = await textarea.inputValue().catch(() => '');
  if (norm(actual) !== norm(desired)) {
    await textarea.evaluate((el, next) => {
      const proto = HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      descriptor?.set?.call(el, next);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, desired).catch(() => {});
    await wait(150);
    actual = await textarea.inputValue().catch(() => '');
  }

  return norm(actual) === norm(desired);
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsAllowRejectedTags(page, metadata) {
  try {
    return await previousFillListingFields.call(this, page, metadata);
  } catch (error) {
    const message = String(error?.message || '');
    const recoverable = /Description field could not be updated after tag entry|Supporting Tags did not persist/i.test(message);
    if (!recoverable) throw error;
  }

  const mainState = await acceptedChipState(page, 'Main Tag', 'Supporting Tags');
  const supportState = await acceptedChipState(page, 'Supporting Tags', 'Description');

  const mainTag = norm(metadata.mainTag).toLowerCase();
  if (!mainTag || !supportState || !mainState.text.toLowerCase().includes(mainTag)) {
    throw new Error(`Redbubble Main Tag is not present after entry. Current Main Tag box: ${mainState.text || '(empty)'}`);
  }

  // Redbubble recommends 10–15 relevant tags total. The Main Tag counts as one,
  // so 9 accepted Supporting Tags is enough. Redbubble may silently remove a tag
  // such as "gift"; that should not block the whole listing.
  if (supportState.count < 9) {
    throw new Error(`Redbubble accepted only ${supportState.count} Supporting Tags; at least 9 are required before continuing.`);
  }

  if (!(await setDescriptionByLabel(page, metadata.description))) {
    throw new Error('Redbubble Description field could not be updated using the current Description-labelled textarea.');
  }

  console.warn(`[ZeroPOD] Redbubble accepted ${supportState.count} Supporting Tags. Fewer than 14 is allowed when Redbubble filters tags.`);
  return true;
};

module.exports = {};
