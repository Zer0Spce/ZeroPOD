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

    // Prefer the actual Marketplace card, not the top navigation action with the same label.
    let heading = null;
    let container = null;
    for (const candidate of headings) {
      let node = candidate;
      for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        const text = ownText(node);
        if (!text.includes('publish on spreadshirt')) continue;
        if (text.includes('sell your products on the spreadshirt marketplace') && text.includes('design status')) {
          heading = candidate;
          container = node;
          break;
        }
      }
      if (container) break;
    }

    if (!heading) {
      heading = headings.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0] || all.find((el) => /publish on spreadshirt/i.test(ownText(el)));
    }
    if (!heading) return null;

    if (!container) {
      let node = heading;
      let fallback = heading.parentElement;
      for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        const text = ownText(node);
        if (!text.includes('publish on spreadshirt')) continue;
        fallback = node;
        if (text.includes('design status')) {
          container = node;
          break;
        }
      }
      container = container || fallback || heading.parentElement || heading;
    }

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
      const aspect = rect.height > 0 ? rect.width / rect.height : 0;
      const switchShape = rect.width >= 45 && rect.width <= 140
        && rect.height >= 20 && rect.height <= 72
        && aspect >= 1.25 && aspect <= 5;
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
        const aShape = ar.height > 0 ? ar.width / ar.height : 0;
        const bShape = br.height > 0 ? br.width / br.height : 0;
        const aTrack = aShape >= 1.4 ? 1000 : 0;
        const bTrack = bShape >= 1.4 ? 1000 : 0;
        return (bSemantic + bTrack + br.right) - (aSemantic + aTrack + ar.right);
      })[0] || null;

    const physicalChecked = physical
      ? physical.getAttribute?.('aria-checked') === 'true'
        || physical.getAttribute?.('data-state') === 'checked'
        || physical.getAttribute?.('data-checked') === 'true'
        || /(^|\s)(checked|active|on|selected)(\s|$)/i.test(String(physical.className || ''))
      : false;

    const saveAndPublishVisible = all.some((el) => /^save and publish$/i.test(
      String(el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
    ));
    const checked = Boolean(
      (roleSwitch && roleSwitch.getAttribute('aria-checked') === 'true')
      || (checkbox && checkbox.checked)
      || physicalChecked
      || saveAndPublishVisible
    );

    const rect = physical ? physical.getBoundingClientRect() : null;
    return {
      checked,
      saveAndPublishVisible,
      hasCheckbox: Boolean(checkbox),
      checkboxVisible: checkbox ? visible(checkbox) : false,
      hasRoleSwitch: Boolean(roleSwitch),
      physicalTargetRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      physicalTargetTag: physical?.tagName || null,
      physicalTargetRole: physical?.getAttribute?.('role') || null,
      physicalTargetClass: String(physical?.className || '').slice(0, 180),
      text: String(container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 420)
    };
  }).catch(() => null);
}

async function saveAndPublishVisibleAnywhere(page) {
  for (const frame of page.frames()) {
    try {
      const candidates = [
        frame.getByRole('button', { name: /^Save and publish$/i }).first(),
        frame.getByText(/^Save and publish$/i, { exact: true }).first()
      ];
      for (const candidate of candidates) {
        if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) return true;
      }
    } catch {}
  }
  return false;
}

async function pagePointForFrameRect(page, frame, rect, fraction = 0.7) {
  if (!rect) return null;
  let x = rect.x + Math.max(3, Math.min(rect.width - 3, rect.width * fraction));
  let y = rect.y + Math.max(3, Math.min(rect.height - 3, rect.height * 0.5));

  if (frame !== page.mainFrame()) {
    try {
      const frameElement = await frame.frameElement();
      const frameBox = await frameElement.boundingBox();
      if (!frameBox) return null;
      x += frameBox.x;
      y += frameBox.y;
    } catch {
      return null;
    }
  }
  return { x, y };
}

async function clickMarketplaceWithNativeMouse(page, frame, state) {
  const point = await pagePointForFrameRect(page, frame, state?.physicalTargetRect, 0.7);
  if (!point) return { clicked: false, reason: 'physical-toggle-rect-not-found' };
  try {
    await page.bringToFront();
    await page.mouse.move(point.x, point.y);
    await wait(80);
    await page.mouse.down();
    await wait(90);
    await page.mouse.up();
    return {
      clicked: true,
      method: 'playwright-native-mouse',
      point,
      rect: state.physicalTargetRect
    };
  } catch (error) {
    return { clicked: false, reason: 'native-mouse-click-failed', message: error?.message || String(error) };
  }
}

async function clickMarketplaceDomFallback(frame) {
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
    const heading = all.find((el) => ownText(el) === 'publish on spreadshirt');
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
    if (roleSwitch && visible(roleSwitch)) {
      try { roleSwitch.click(); return { clicked: true, method: 'role-switch-dom-fallback' }; } catch {}
    }
    if (labelForCheckbox && visible(labelForCheckbox)) {
      try { labelForCheckbox.click(); return { clicked: true, method: 'visible-label-dom-fallback' }; } catch {}
    }
    if (checkbox) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      descriptor?.set?.call(checkbox, true);
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      return { clicked: true, method: 'native-checkbox-setter-fallback' };
    }
    return { clicked: false, reason: 'marketplace-control-not-found' };
  }).catch(() => ({ clicked: false, reason: 'evaluate-failed' }));
}

async function clickMarketplaceVisibleControl(frame, page = null) {
  if (page) {
    const state = await marketplaceState(frame);
    if (state?.checked) return { clicked: false, alreadyChecked: true, method: 'already-enabled' };
    if (state?.physicalTargetRect) {
      return clickMarketplaceWithNativeMouse(page, frame, state);
    }
  }
  return clickMarketplaceDomFallback(frame);
}

async function enableMarketplaceCustomToggle(page) {
  for (const frame of page.frames()) {
    const before = await marketplaceState(frame);
    if (!before) continue;
    if (before.checked === true || await saveAndPublishVisibleAnywhere(page)) {
      return { ok: true, changed: false, method: 'already-enabled' };
    }

    const action = await clickMarketplaceVisibleControl(frame, page);
    if (action?.alreadyChecked) return { ok: true, changed: false, method: 'already-enabled' };
    if (!action?.clicked) continue;

    const started = Date.now();
    while (Date.now() - started < 10000) {
      const after = await marketplaceState(frame);
      if (after?.checked === true || after?.saveAndPublishVisible || await saveAndPublishVisibleAnywhere(page)) {
        return { ok: true, changed: true, method: action.method || 'playwright-native-mouse' };
      }
      await wait(180);
    }

    const text = await frame.locator('body').innerText().catch(() => '');
    if (/Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error/i.test(text)) {
      return { ok: false, changed: false, method: action.method || 'playwright-native-mouse', reason: 'spreadshirt-error' };
    }
    return {
      ok: false,
      changed: false,
      method: action.method || 'playwright-native-mouse',
      reason: 'toggle-did-not-turn-on',
      state: await marketplaceState(frame)
    };
  }
  return { ok: false, changed: false, method: 'not-found', reason: 'publish-card-not-found' };
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
      label: 'Spreadshirt uses a hidden marketplace checkbox. Clicking the visible Publish on Spreadshirt switch with a real browser mouse…'
    });

    const result = await enableMarketplaceCustomToggle(page);
    if (!result.ok) {
      this.projects.addActivity(projectId, {
        type: 'spreadshirt',
        label: 'Publish on Spreadshirt stayed OFF during preparation. Metadata is ready, so Final Review will continue; Pass · Publish will activate the switch before publishing.'
      });
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
        marketplaceSwitchPrepared: Boolean(result.ok),
        lastError: null
      }
    });
    this.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: result.ok
        ? 'Publish on Spreadshirt is ON through the real browser mouse click. Final review is ready.'
        : 'Spreadshirt metadata is ready for Final Review. Marketplace publishing will be activated on Pass · Publish.'
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
  saveAndPublishVisibleAnywhere,
  pagePointForFrameRect,
  clickMarketplaceWithNativeMouse,
  clickMarketplaceVisibleControl,
  enableMarketplaceCustomToggle
};
