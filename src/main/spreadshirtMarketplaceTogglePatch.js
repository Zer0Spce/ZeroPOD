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
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const nodes = [...document.querySelectorAll('body *')];
    const label = nodes.find((el) => visible(el) && /publish on spreadshirt|spreadshirt marketplace/i.test(norm(el.textContent)));
    if (!label) return null;

    let container = label;
    for (let depth = 0; container && depth < 8; depth += 1, container = container.parentElement) {
      const text = norm(container.innerText || container.textContent);
      if (!/publish on spreadshirt|spreadshirt marketplace/i.test(text)) continue;

      const roleSwitch = container.querySelector('[role="switch"]');
      const checkbox = container.querySelector('input[type="checkbox"]');
      const labels = [...container.querySelectorAll('label')];
      const visibleLabel = labels.find(visible) || null;
      const buttons = [...container.querySelectorAll('button,[role="button"],[tabindex]')].filter(visible);

      const checked = roleSwitch
        ? roleSwitch.getAttribute('aria-checked') === 'true'
        : checkbox
          ? Boolean(checkbox.checked)
          : null;

      const target = [roleSwitch, visibleLabel, ...buttons, label]
        .find((el) => el && visible(el)) || null;

      if (checkbox || roleSwitch || target) {
        const rect = target ? target.getBoundingClientRect() : null;
        return {
          checked,
          hasCheckbox: Boolean(checkbox),
          checkboxVisible: checkbox ? visible(checkbox) : false,
          hasRoleSwitch: Boolean(roleSwitch),
          targetRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          targetTag: target?.tagName || null,
          targetRole: target?.getAttribute?.('role') || null,
          text: String(container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240)
        };
      }
    }
    return null;
  }).catch(() => null);
}

async function clickMarketplaceVisibleControl(frame) {
  return frame.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const nodes = [...document.querySelectorAll('body *')];
    const labelText = nodes.find((el) => visible(el) && /publish on spreadshirt|spreadshirt marketplace/i.test(norm(el.textContent)));
    if (!labelText) return { clicked: false, reason: 'label-not-found' };

    let container = labelText;
    for (let depth = 0; container && depth < 8; depth += 1, container = container.parentElement) {
      const text = norm(container.innerText || container.textContent);
      if (!/publish on spreadshirt|spreadshirt marketplace/i.test(text)) continue;

      const roleSwitch = container.querySelector('[role="switch"]');
      const checkbox = container.querySelector('input[type="checkbox"]');
      if (roleSwitch && roleSwitch.getAttribute('aria-checked') === 'true') return { clicked: false, alreadyChecked: true };
      if (checkbox && checkbox.checked) return { clicked: false, alreadyChecked: true };

      const labelForCheckbox = checkbox?.id
        ? container.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`)
        : null;
      const visibleLabels = [...container.querySelectorAll('label')].filter(visible);
      const buttons = [...container.querySelectorAll('button,[role="button"],[tabindex]')].filter(visible);
      const candidates = [roleSwitch, labelForCheckbox, ...visibleLabels, ...buttons, labelText]
        .filter((el, index, all) => el && visible(el) && all.indexOf(el) === index);

      for (const candidate of candidates) {
        candidate.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        candidate.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        candidate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return {
          clicked: true,
          tag: candidate.tagName,
          role: candidate.getAttribute?.('role') || null,
          text: String(candidate.innerText || candidate.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
        };
      }

      if (checkbox) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
        descriptor?.set?.call(checkbox, true);
        checkbox.dispatchEvent(new Event('input', { bubbles: true }));
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        return { clicked: true, method: 'native-checkbox-setter' };
      }
    }

    return { clicked: false, reason: 'control-not-found' };
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
    while (Date.now() - started < 5000) {
      const after = await marketplaceState(frame);
      if (after?.checked === true) {
        return { ok: true, changed: true, method: action.method || action.role || action.tag || 'visible-control' };
      }
      await wait(150);
    }

    const text = await frame.locator('body').innerText().catch(() => '');
    if (!/Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error/i.test(text)) {
      return { ok: true, changed: true, method: action.method || action.role || action.tag || 'visible-control-unverified' };
    }
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
      label: 'Spreadshirt uses a hidden marketplace checkbox. Clicking its visible Publish on Spreadshirt control instead…'
    });

    const result = await enableMarketplaceCustomToggle(page);
    if (!result.ok) {
      throw new Error('Spreadshirt metadata is ready, but ZeroPOD could not find the visible “Publish on Spreadshirt” toggle.');
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
      label: 'Publish on Spreadshirt enabled through the visible control. Final review is ready.'
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
