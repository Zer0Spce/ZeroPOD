const fs = require('fs');
const path = require('path');
const { feature } = require('./spreadshirtAlphaIpc');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function marketplaceState(frame) {
  return frame.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };

    const ownText = (el) => norm(el?.innerText || el?.textContent || '');
    const all = [...document.querySelectorAll('body *')].filter(visible);
    const headings = all.filter((el) => ownText(el) === 'publish on spreadshirt');
    const heading = headings.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    })[0] || all.find((el) => /publish on spreadshirt/i.test(ownText(el)));
    if (!heading) return null;

    let container = heading;
    let fallback = heading.parentElement;
    for (let depth = 0; container && depth < 10; depth += 1, container = container.parentElement) {
      const text = ownText(container);
      if (!text.includes('publish on spreadshirt')) continue;
      fallback = container;
      if (text.includes('design status')) break;
    }
    container = container || fallback || heading.parentElement || heading;

    const roleSwitch = container.querySelector?.('[role="switch"]') || null;
    const checkbox = container.querySelector?.('input[type="checkbox"]') || null;
    const labelForCheckbox = checkbox?.id
      ? container.querySelector?.(`label[for="${CSS.escape(checkbox.id)}"]`) || null
      : null;

    const containerRect = container.getBoundingClientRect();
    const statusLabel = [...container.querySelectorAll?.('*') || []]
      .filter(visible)
      .find((el) => ownText(el) === 'design status');
    const statusTop = statusLabel ? statusLabel.getBoundingClientRect().top : containerRect.bottom;

    const heuristicCandidates = [...container.querySelectorAll?.('*') || []].filter((el) => {
      if (!visible(el)) return false;
      const rect = el.getBoundingClientRect();
      const cls = String(el.className || '');
      const semantic = el === roleSwitch
        || el === labelForCheckbox
        || /switch|toggle|checkbox/i.test(cls)
        || el.getAttribute?.('aria-checked') !== null
        || el.getAttribute?.('role') === 'switch';
      const switchShape = rect.width >= 38 && rect.width <= 130 && rect.height >= 20 && rect.height <= 80;
      const rightSide = rect.left >= containerRect.left + (containerRect.width * 0.58);
      const aboveStatus = rect.top < statusTop - 2;
      return (semantic || switchShape) && switchShape && rightSide && aboveStatus;
    });

    const physical = [roleSwitch, labelForCheckbox, ...heuristicCandidates]
      .filter((el, index, list) => el && visible(el) && list.indexOf(el) === index)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aSemantic = a === roleSwitch || /switch|toggle/i.test(String(a.className || '')) ? 10000 : 0;
        const bSemantic = b === roleSwitch || /switch|toggle/i.test(String(b.className || '')) ? 10000 : 0;
        return (bSemantic + br.right - br.width * 0.1) - (aSemantic + ar.right - ar.width * 0.1);
      })[0] || null;

    const physicalChecked = physical
      ? physical.getAttribute?.('aria-checked') === 'true'
        || physical.getAttribute?.('data-state') === 'checked'
        || physical.getAttribute?.('data-checked') === 'true'
        || /(^|\s)(checked|active|on|selected)(\s|$)/i.test(String(physical.className || ''))
      : false;

    const saveAndPublishVisible = all.some((el) => /^save and publish$/i.test(String(el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim()));
    const checked = roleSwitch
      ? roleSwitch.getAttribute('aria-checked') === 'true'
      : checkbox
        ? Boolean(checkbox.checked)
        : physical
          ? Boolean(physicalChecked)
          : null;

    const rect = physical ? physical.getBoundingClientRect() : null;
    return {
      checked: checked === true || saveAndPublishVisible,
      saveAndPublishVisible,
      hasCheckbox: Boolean(checkbox),
      checkboxVisible: checkbox ? visible(checkbox) : false,
      hasRoleSwitch: Boolean(roleSwitch),
      physicalTargetRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      physicalTargetTag: physical?.tagName || null,
      physicalTargetRole: physical?.getAttribute?.('role') || null,
      physicalTargetClass: String(physical?.className || '').slice(0, 180),
      text: String(container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 320)
    };
  }).catch(() => null);
}

async function clickMarketplaceVisibleControl(frame) {
  return frame.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };
    const ownText = (el) => norm(el?.innerText || el?.textContent || '');

    const all = [...document.querySelectorAll('body *')].filter(visible);
    const headings = all.filter((el) => ownText(el) === 'publish on spreadshirt');
    const heading = headings.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    })[0] || all.find((el) => /publish on spreadshirt/i.test(ownText(el)));
    if (!heading) return { clicked: false, reason: 'heading-not-found' };

    let container = heading;
    let fallback = heading.parentElement;
    for (let depth = 0; container && depth < 10; depth += 1, container = container.parentElement) {
      const text = ownText(container);
      if (!text.includes('publish on spreadshirt')) continue;
      fallback = container;
      if (text.includes('design status')) break;
    }
    container = container || fallback || heading.parentElement || heading;

    const roleSwitch = container.querySelector?.('[role="switch"]') || null;
    const checkbox = container.querySelector?.('input[type="checkbox"]') || null;
    if (roleSwitch && roleSwitch.getAttribute('aria-checked') === 'true') return { clicked: false, alreadyChecked: true };
    if (checkbox && checkbox.checked) return { clicked: false, alreadyChecked: true };

    const labelForCheckbox = checkbox?.id
      ? container.querySelector?.(`label[for="${CSS.escape(checkbox.id)}"]`) || null
      : null;
    const containerRect = container.getBoundingClientRect();
    const statusLabel = [...container.querySelectorAll?.('*') || []]
      .filter(visible)
      .find((el) => ownText(el) === 'design status');
    const statusTop = statusLabel ? statusLabel.getBoundingClientRect().top : containerRect.bottom;

    const heuristicCandidates = [...container.querySelectorAll?.('*') || []].filter((el) => {
      if (!visible(el)) return false;
      const rect = el.getBoundingClientRect();
      const cls = String(el.className || '');
      const semantic = el === roleSwitch
        || el === labelForCheckbox
        || /switch|toggle|checkbox/i.test(cls)
        || el.getAttribute?.('aria-checked') !== null
        || el.getAttribute?.('role') === 'switch';
      const switchShape = rect.width >= 38 && rect.width <= 130 && rect.height >= 20 && rect.height <= 80;
      const rightSide = rect.left >= containerRect.left + (containerRect.width * 0.58);
      const aboveStatus = rect.top < statusTop - 2;
      return (semantic || switchShape) && switchShape && rightSide && aboveStatus;
    });

    const physical = [roleSwitch, labelForCheckbox, ...heuristicCandidates]
      .filter((el, index, list) => el && visible(el) && list.indexOf(el) === index)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aSemantic = a === roleSwitch || /switch|toggle/i.test(String(a.className || '')) ? 10000 : 0;
        const bSemantic = b === roleSwitch || /switch|toggle/i.test(String(b.className || '')) ? 10000 : 0;
        return (bSemantic + br.right - br.width * 0.1) - (aSemantic + ar.right - ar.width * 0.1);
      })[0] || null;

    if (physical) {
      const rect = physical.getBoundingClientRect();
      const x = Math.max(rect.left + 2, Math.min(rect.right - 2, rect.left + rect.width * 0.72));
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y) || physical;
      const clickable = hit.closest?.('button,label,[role="switch"],[role="button"],[tabindex]') || physical;
      try { clickable.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
      try {
        clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
        clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
        clickable.click();
        return {
          clicked: true,
          method: 'physical-right-toggle',
          tag: clickable.tagName,
          role: clickable.getAttribute?.('role') || null,
          className: String(clickable.className || '').slice(0, 160),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      } catch {}
    }

    if (labelForCheckbox && visible(labelForCheckbox)) {
      try {
        labelForCheckbox.click();
        return { clicked: true, method: 'visible-label-for-checkbox' };
      } catch {}
    }

    if (checkbox) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      descriptor?.set?.call(checkbox, true);
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      return { clicked: true, method: 'native-checkbox-setter' };
    }

    return { clicked: false, reason: 'physical-toggle-not-found' };
  }).catch(() => ({ clicked: false, reason: 'evaluate-failed' }));
}

async function enableMarketplaceCustomToggle(page) {
  for (const frame of page.frames()) {
    const before = await marketplaceState(frame);
    if (!before) continue;
    if (before.checked === true) return { ok: true, changed: false, method: 'already-enabled' };

    const action = await clickMarketplaceVisibleControl(frame);
    if (action?.alreadyChecked) return { ok: true, changed: false, method: 'already-enabled' };
    if (!action?.clicked) continue;

    const started = Date.now();
    while (Date.now() - started < 8000) {
      const after = await marketplaceState(frame);
      if (after?.checked === true || after?.saveAndPublishVisible) {
        return { ok: true, changed: true, method: action.method || action.role || action.tag || 'physical-right-toggle' };
      }
      await wait(150);
    }

    const text = await frame.locator('body').innerText().catch(() => '');
    if (/Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error/i.test(text)) {
      return { ok: false, changed: false, method: action.method || 'physical-right-toggle', reason: 'spreadshirt-error' };
    }

    return { ok: false, changed: false, method: action.method || 'physical-right-toggle', reason: 'toggle-did-not-turn-on' };
  }

  return { ok: false, changed: false, method: 'not-found' };
}

const previousPrepare = feature.prepare.bind(feature);
feature.prepare = async function prepareWithMarketplaceToggleFix(projectId) {
  try {
    return await previousPrepare(projectId);
  } catch (error) {
    const message = String(error?.message || error || '');
    const hiddenToggleFailure = /locator\.click: Element is not visible|locator\.check/i.test(message)
      && /Spreadshirt marketplace|Publish on Spreadshirt|input\[type="checkbox"\]/i.test(message);
    if (!hiddenToggleFailure) throw error;

    const { page } = await this.sessions.ensureService('spreadshirt');
    await page.bringToFront();
    this.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: 'Spreadshirt uses a hidden marketplace checkbox. Clicking the visible Publish on Spreadshirt control — the physical right-side switch — instead…'
    });

    const result = await enableMarketplaceCustomToggle(page);
    if (!result.ok) {
      throw new Error('Spreadshirt metadata is ready, but ZeroPOD could not turn on the physical “Publish on Spreadshirt” switch.');
    }

    const current = this.projects.read(projectId);
    const screenshotPath = path.join(this.projects.getProjectDir(projectId), 'spreadshirt-final-review.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(current.spreadshirt || {}),
        status: 'review',
        preparedAt: new Date().toISOString(),
        editorUrl: page.url(),
        reviewScreenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : current.spreadshirt?.reviewScreenshotPath || null,
        lastError: null
      }
    });
    this.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: 'Publish on Spreadshirt is ON through the physical right-side switch. Final review is ready.'
    });
    return {
      ok: true,
      project: updated,
      url: page.url(),
      reviewScreenshotPath: updated.spreadshirt?.reviewScreenshotPath || null,
      message: 'Spreadshirt listing is prepared for final review.'
    };
  }
};

module.exports = {
  marketplaceState,
  clickMarketplaceVisibleControl,
  enableMarketplaceCustomToggle
};
