const { RedbubbleController } = require('./redbubbleController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const previousPrepare = RedbubbleController.prototype.prepare;
const previousFillListingFields = RedbubbleController.prototype.fillListingFields;
const runState = new WeakMap();

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function findDescriptionTarget(page) {
  return page.evaluate(() => {
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
      .filter(({ r }) => r.top >= lr.bottom - 12 && r.top <= lr.bottom + 600)
      .sort((a, b) => {
        const ad = Math.max(0, a.r.top - lr.bottom) * 5 + Math.abs(a.r.left - lr.left);
        const bd = Math.max(0, b.r.top - lr.bottom) * 5 + Math.abs(b.r.left - lr.left);
        return ad - bd;
      });

    const chosen = candidates[0];
    if (!chosen) return null;
    const el = chosen.el;
    const r = chosen.r;
    return {
      x: r.left + Math.min(Math.max(24, r.width * 0.15), Math.max(24, r.width - 24)),
      y: r.top + Math.min(Math.max(18, r.height * 0.25), Math.max(18, r.height - 18)),
      tag: el.tagName,
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      readOnly: Boolean(el.readOnly),
      disabled: Boolean(el.disabled),
      maxLength: typeof el.maxLength === 'number' ? el.maxLength : -1,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  }).catch(() => null);
}

async function readDescriptionFresh(page) {
  return page.evaluate(() => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const label = nodes.find((el) => tidy(el.innerText || el.textContent) === 'Description');
    if (!label) return { value: '', active: '', found: false };
    const lr = label.getBoundingClientRect();
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top >= lr.bottom - 12 && r.top <= lr.bottom + 600)
      .sort((a, b) => (Math.max(0, a.r.top - lr.bottom) * 5 + Math.abs(a.r.left - lr.left)) - (Math.max(0, b.r.top - lr.bottom) * 5 + Math.abs(b.r.left - lr.left)));
    const chosen = candidates[0]?.el;
    if (!chosen) return { value: '', active: '', found: false };
    return {
      value: 'value' in chosen ? String(chosen.value || '') : String(chosen.innerText || chosen.textContent || ''),
      active: document.activeElement === chosen ? chosen.tagName : (document.activeElement?.tagName || ''),
      found: true
    };
  }).catch(() => ({ value: '', active: '', found: false }));
}

async function nativeInsert(page, desired) {
  return page.evaluate((next) => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const label = nodes.find((el) => tidy(el.innerText || el.textContent) === 'Description');
    if (!label) return false;
    const lr = label.getBoundingClientRect();
    const target = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top >= lr.bottom - 12 && r.top <= lr.bottom + 600)
      .sort((a, b) => (Math.max(0, a.r.top - lr.bottom) * 5 + Math.abs(a.r.left - lr.left)) - (Math.max(0, b.r.top - lr.bottom) * 5 + Math.abs(b.r.left - lr.left)))[0]?.el;
    if (!target) return false;

    target.focus();
    const oldValue = 'value' in target ? String(target.value || '') : String(target.textContent || '');
    if (target instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(target, next);
    } else if (target instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(target, next);
    } else {
      target.textContent = next;
    }
    if (target._valueTracker && typeof target._valueTracker.setValue === 'function') {
      target._valueTracker.setValue(oldValue);
    }
    try {
      target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: next }));
    } catch {}
    try {
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
    } catch {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, desired).catch(() => false);
}

async function execCommandInsert(page, desired) {
  return page.evaluate((next) => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = [...document.querySelectorAll('body *')].filter(visible);
    const label = nodes.find((el) => tidy(el.innerText || el.textContent) === 'Description');
    if (!label) return false;
    const lr = label.getBoundingClientRect();
    const target = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top >= lr.bottom - 12 && r.top <= lr.bottom + 600)
      .sort((a, b) => (Math.max(0, a.r.top - lr.bottom) * 5 + Math.abs(a.r.left - lr.left)) - (Math.max(0, b.r.top - lr.bottom) * 5 + Math.abs(b.r.left - lr.left)))[0]?.el;
    if (!target) return false;
    target.focus();
    if ('selectionStart' in target && 'selectionEnd' in target) {
      target.selectionStart = 0;
      target.selectionEnd = String(target.value || '').length;
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    try {
      return Boolean(document.execCommand('insertText', false, next));
    } catch {
      return false;
    }
  }, desired).catch(() => false);
}

async function coordinateWriteDescription(page, rawValue) {
  let desired = String(rawValue || '').trim();
  if (!desired) throw new Error('ZeroPOD metadata Description is empty.');

  const info = await findDescriptionTarget(page);
  if (!info) throw new Error('Redbubble Description target could not be located by geometry.');
  if (info.readOnly || info.disabled) throw new Error('Redbubble Description target is not writable.');
  if (info.maxLength > 0 && desired.length > info.maxLength) desired = desired.slice(0, info.maxLength).trimEnd();

  const observations = [];
  const verify = async (label, blur = false) => {
    await wait(220);
    let state = await readDescriptionFresh(page);
    observations.push(`${label}:${String(state.value || '').length}`);
    if (norm(state.value) !== norm(desired)) return false;
    if (blur) {
      await page.keyboard.press('Tab').catch(() => {});
      await wait(250);
      state = await readDescriptionFresh(page);
      observations.push(`${label}-blur:${String(state.value || '').length}`);
      return norm(state.value) === norm(desired);
    }
    return true;
  };

  // Strategy 1: click the visible textarea by coordinates, then type through CDP.
  await page.mouse.click(info.x, info.y).catch(() => {});
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.keyboard.insertText(desired).catch(() => {});
  if (await verify('keyboard', true)) return true;

  // Strategy 2: same coordinate focus but sequential key events.
  const fresh = await findDescriptionTarget(page);
  if (fresh) {
    await page.mouse.click(fresh.x, fresh.y).catch(() => {});
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(desired, { delay: 1 }).catch(() => {});
    if (await verify('type', true)) return true;
  }

  // Strategy 3: native setter + beforeinput/input/change events, then wake React with one real keystroke.
  await nativeInsert(page, desired);
  let state = await readDescriptionFresh(page);
  observations.push(`native:${String(state.value || '').length}`);
  if (norm(state.value) === norm(desired)) {
    const again = await findDescriptionTarget(page);
    if (again) {
      await page.mouse.click(again.x, again.y).catch(() => {});
      await page.keyboard.insertText(' ').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      if (await verify('native-wake', true)) return true;
    }
  }

  // Strategy 4: browser editing command against a freshly found element.
  await execCommandInsert(page, desired);
  if (await verify('execCommand', true)) return true;

  const finalState = await readDescriptionFresh(page);
  throw new Error(`Redbubble Description still rejected input. target=${info.tag}, name=${info.name || '-'}, id=${info.id || '-'}, placeholder=${String(info.placeholder || '-').slice(0, 80)}, maxLength=${info.maxLength}, active=${finalState.active || '-'}, storedLength=${String(finalState.value || '').length}, desiredLength=${desired.length}, attempts=${observations.join('|')}.`);
}

RedbubbleController.prototype.prepare = async function prepareWithFreshDescriptionState(projectId) {
  runState.set(this, { projectId, coreDone: false });
  return previousPrepare.call(this, projectId);
};

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsCoordinateDescription(page, metadata) {
  const state = runState.get(this) || { coreDone: false };

  if (state.coreDone) {
    await coordinateWriteDescription(page, metadata.description);
    return true;
  }

  try {
    return await previousFillListingFields.call(this, page, metadata);
  } catch (error) {
    const message = String(error?.message || '');
    if (!/Description/i.test(message)) throw error;
    state.coreDone = true;
    runState.set(this, state);
    await coordinateWriteDescription(page, metadata.description);
    return true;
  }
};

module.exports = { coordinateWriteDescription };
