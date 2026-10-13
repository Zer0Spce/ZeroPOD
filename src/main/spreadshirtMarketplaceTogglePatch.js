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
    const rectData = (el) => {
      if (!el || !visible(el)) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
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
    const nestedLabel = checkbox?.closest?.('label') || null;
    const clickableAncestor = checkbox?.closest?.('[role="switch"],[role="checkbox"],button') || null;

    const containerRect = container.getBoundingClientRect();
    const statusLabel = [...container.querySelectorAll?.('*') || []]
      .filter(visible)
      .find((el) => ownText(el) === 'design status');
    const statusTop = statusLabel ? statusLabel.getBoundingClientRect().top : containerRect.bottom;

    const switchShape = (el) => {
      if (!visible(el)) return false;
      const rect = el.getBoundingClientRect();
      const aspect = rect.height > 0 ? rect.width / rect.height : 0;
      return rect.width >= 42 && rect.width <= 180
        && rect.height >= 20 && rect.height <= 82
        && aspect >= 1.1 && aspect <= 6
        && rect.left >= containerRect.left + (containerRect.width * 0.5)
        && rect.top < statusTop - 2;
    };

    // Derive the primary physical target from the checkbox's own DOM neighborhood.
    // This is more reliable than guessing a switch-shaped rectangle elsewhere in the card.
    const linked = [];
    const pushLinked = (el) => {
      if (!el || !visible(el) || linked.includes(el)) return;
      if (switchShape(el)) linked.push(el);
    };
    pushLinked(roleSwitch);
    pushLinked(labelForCheckbox);
    pushLinked(nestedLabel);
    pushLinked(clickableAncestor);

    let checkboxNode = checkbox?.parentElement || null;
    for (let depth = 0; checkboxNode && depth < 5; depth += 1, checkboxNode = checkboxNode.parentElement) {
      pushLinked(checkboxNode);
      pushLinked(checkboxNode.previousElementSibling);
      pushLinked(checkboxNode.nextElementSibling);
      for (const child of [...checkboxNode.children]) pushLinked(child);
      const nearby = [...checkboxNode.querySelectorAll?.('[role="switch"],[role="checkbox"],label,button,[class*="switch" i],[class*="toggle" i]') || []];
      for (const candidate of nearby) pushLinked(candidate);
      if (checkboxNode === container) break;
    }

    const linkedTarget = linked.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const aSemantic = a === roleSwitch || a === labelForCheckbox || a === nestedLabel || a === clickableAncestor ? 10000 : 0;
      const bSemantic = b === roleSwitch || b === labelForCheckbox || b === nestedLabel || b === clickableAncestor ? 10000 : 0;
      const aClass = /switch|toggle/i.test(String(a.className || '')) ? 1000 : 0;
      const bClass = /switch|toggle/i.test(String(b.className || '')) ? 1000 : 0;
      return (bSemantic + bClass + br.right) - (aSemantic + aClass + ar.right);
    })[0] || null;

    // Retain the earlier geometry detector only as a fallback.
    const heuristicCandidates = [...container.querySelectorAll?.('*') || []].filter((el) => {
      if (!switchShape(el)) return false;
      const cls = String(el.className || '');
      const semantic = el === roleSwitch
        || el === labelForCheckbox
        || /switch|toggle|checkbox/i.test(cls)
        || el.getAttribute?.('aria-checked') !== null
        || el.getAttribute?.('role') === 'switch';
      return semantic || switchShape(el);
    });

    const physical = [linkedTarget, roleSwitch, labelForCheckbox, ...heuristicCandidates]
      .filter((el, index, list) => el && visible(el) && list.indexOf(el) === index)
      .sort((a, b) => {
        if (a === linkedTarget && b !== linkedTarget) return -1;
        if (b === linkedTarget && a !== linkedTarget) return 1;
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aSemantic = a === roleSwitch || /switch|toggle/i.test(String(a.className || '')) ? 10000 : 0;
        const bSemantic = b === roleSwitch || /switch|toggle/i.test(String(b.className || '')) ? 10000 : 0;
        return (bSemantic + br.right) - (aSemantic + ar.right);
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

    return {
      checked,
      saveAndPublishVisible,
      hasCheckbox: Boolean(checkbox),
      checkboxChecked: Boolean(checkbox?.checked),
      checkboxVisible: checkbox ? visible(checkbox) : false,
      hasRoleSwitch: Boolean(roleSwitch),
      checkboxLinkedTargetRect: rectData(linkedTarget),
      checkboxLinkedTargetTag: linkedTarget?.tagName || null,
      checkboxLinkedTargetRole: linkedTarget?.getAttribute?.('role') || null,
      checkboxLinkedTargetClass: String(linkedTarget?.className || '').slice(0, 180),
      physicalTargetRect: rectData(physical),
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

async function waitForMarketplaceEnabled(page, frame, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await marketplaceState(frame);
    if (state?.checked === true || state?.saveAndPublishVisible || await saveAndPublishVisibleAnywhere(page)) {
      return { ok: true, state };
    }
    await wait(180);
  }
  return { ok: false, state: await marketplaceState(frame) };
}

async function pagePointForFrameRect(page, frame, rect, fraction = 0.5) {
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
  const linkedRect = state?.checkboxLinkedTargetRect || null;
  const targetRect = linkedRect || state?.physicalTargetRect || null;
  const point = await pagePointForFrameRect(page, frame, targetRect, linkedRect ? 0.5 : 0.7);
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
      method: linkedRect ? 'playwright-checkbox-wrapper-mouse' : 'playwright-native-mouse',
      point,
      rect: targetRect
    };
  } catch (error) {
    return { clicked: false, reason: 'native-mouse-click-failed', message: error?.message || String(error) };
  }
}

async function activateCheckboxNatively(frame) {
  return frame.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const ownText = (el) => norm(el?.innerText || el?.textContent || '');
    const headings = [...document.querySelectorAll('body *')].filter(visible).filter((el) => ownText(el) === 'publish on spreadshirt');
    let container = null;
    for (const heading of headings) {
      let node = heading;
      for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        const text = ownText(node);
        if (text.includes('sell your products on the spreadshirt marketplace') && text.includes('design status')) {
          container = node;
          break;
        }
      }
      if (container) break;
    }
    if (!container) return { clicked: false, reason: 'publish-card-not-found' };

    const checkbox = container.querySelector('input[type="checkbox"]');
    if (!checkbox) return { clicked: false, reason: 'checkbox-not-found' };
    if (checkbox.checked) return { clicked: false, alreadyChecked: true, method: 'already-enabled' };

    try {
      checkbox.click();
      if (checkbox.checked) {
        return { clicked: true, method: 'checkbox-native-click', checked: true };
      }
    } catch {}

    // Last browser-side fallback for Vue/custom checkbox implementations.
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      descriptor?.set?.call(checkbox, true);
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      checkbox.dispatchEvent(new Event('click', { bubbles: true }));
      return { clicked: true, method: 'checkbox-native-setter', checked: Boolean(checkbox.checked) };
    } catch (error) {
      return { clicked: false, reason: 'checkbox-native-activation-failed', message: error?.message || String(error) };
    }
  }).catch((error) => ({ clicked: false, reason: 'checkbox-native-evaluate-failed', message: error?.message || String(error) }));
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
    const nestedLabel = checkbox?.closest?.('label') || null;
    if (roleSwitch && visible(roleSwitch)) {
      try { roleSwitch.click(); return { clicked: true, method: 'role-switch-dom-fallback' }; } catch {}
    }
    if (labelForCheckbox && visible(labelForCheckbox)) {
      try { labelForCheckbox.click(); return { clicked: true, method: 'visible-label-dom-fallback' }; } catch {}
    }
    if (nestedLabel && visible(nestedLabel)) {
      try { nestedLabel.click(); return { clicked: true, method: 'nested-label-dom-fallback' }; } catch {}
    }
    if (checkbox) {
      try { checkbox.click(); return { clicked: true, method: 'checkbox-native-click' }; } catch {}
    }
    return { clicked: false, reason: 'marketplace-control-not-found' };
  }).catch(() => ({ clicked: false, reason: 'evaluate-failed' }));
}

async function clickMarketplaceVisibleControl(frame, page = null) {
  if (page) {
    const state = await marketplaceState(frame);
    if (state?.checked) return { clicked: false, alreadyChecked: true, method: 'already-enabled' };
    if (state?.checkboxLinkedTargetRect || state?.physicalTargetRect) {
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

    // Attempt 1: trusted mouse on a visible wrapper derived directly from the checkbox DOM.
    const action = await clickMarketplaceVisibleControl(frame, page);
    if (action?.alreadyChecked) return { ok: true, changed: false, method: 'already-enabled' };
    if (action?.clicked) {
      const verified = await waitForMarketplaceEnabled(page, frame, 4500);
      if (verified.ok) return { ok: true, changed: true, method: action.method || 'playwright-checkbox-wrapper-mouse' };
    }

    // Attempt 2: the hidden checkbox is a real input. Native HTMLElement.click() performs
    // checkbox activation and fires Spreadshirt/Vue click + change listeners even though
    // Playwright cannot physically click the hidden input itself.
    const checkboxAction = await activateCheckboxNatively(frame);
    if (checkboxAction?.alreadyChecked) return { ok: true, changed: false, method: 'already-enabled' };
    if (checkboxAction?.clicked) {
      const verified = await waitForMarketplaceEnabled(page, frame, 6000);
      if (verified.ok) return { ok: true, changed: true, method: checkboxAction.method || 'checkbox-native-click' };
    }

    // Attempt 3: preserve the older semantic DOM fallback as a final bounded retry.
    const fallback = await clickMarketplaceDomFallback(frame);
    if (fallback?.alreadyChecked) return { ok: true, changed: false, method: 'already-enabled' };
    if (fallback?.clicked) {
      const verified = await waitForMarketplaceEnabled(page, frame, 4000);
      if (verified.ok) return { ok: true, changed: true, method: fallback.method || 'dom-fallback' };
    }

    const text = await frame.locator('body').innerText().catch(() => '');
    if (/Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error/i.test(text)) {
      return { ok: false, changed: false, method: checkboxAction?.method || action?.method || 'switch-activation', reason: 'spreadshirt-error' };
    }
    return {
      ok: false,
      changed: false,
      method: checkboxAction?.method || action?.method || 'switch-activation',
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
      label: 'Spreadshirt uses a hidden marketplace checkbox. Activating its exact visible switch wrapper and native checkbox events…'
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
        ? `Publish on Spreadshirt is ON (${result.method || 'verified'}). Final review is ready.`
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
  waitForMarketplaceEnabled,
  pagePointForFrameRect,
  clickMarketplaceWithNativeMouse,
  activateCheckboxNatively,
  clickMarketplaceVisibleControl,
  enableMarketplaceCustomToggle
};
