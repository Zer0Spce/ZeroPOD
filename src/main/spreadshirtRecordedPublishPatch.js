const { feature } = require('./spreadshirtAlphaIpc');
const {
  enableMarketplaceCustomToggle,
  marketplaceState
} = require('./spreadshirtMarketplaceTogglePatch');
const { verifyMarketplacePublished } = require('./spreadshirtFinalPublishPatch');
const { ensureFullFrontPlacement } = require('./spreadshirtRecordedPlacementPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PUBLISHED_UNDER_REVIEW = /Your design has been published, but is still under review/i;
const OTHER_SUCCESS = /successfully published|published successfully|publication submitted|Well done!|Woohoo!?\s+You[’']ve made it/i;
const FAILURE = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error|Something went wrong/i;

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

async function allFramesText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 1200 });
      if (text) chunks.push(text);
    } catch {}
  }
  return chunks.join('\n');
}

async function visibleActions(page) {
  const labels = [];
  for (const frame of page.frames()) {
    const frameLabels = await frame.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      return [...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')]
        .filter(visible)
        .map((el) => String(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 40);
    }).catch(() => []);
    labels.push(...frameLabels);
  }
  return [...new Set(labels)].slice(0, 50);
}

async function marketplacePublishingState(page) {
  let sawControl = false;
  for (const frame of page.frames()) {
    const state = await marketplaceState(frame).catch(() => null);
    if (!state) continue;
    sawControl = true;
    if (state.checked === true) return { verified: true, enabled: true, state };
    if (state.checked === false) return { verified: true, enabled: false, state };
  }
  return { verified: false, enabled: false, sawControl };
}

async function waitForMarketplacePublishingEnabled(page, timeoutMs = 7000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await marketplacePublishingState(page);
    if (last.verified && last.enabled) return last;
    await wait(180);
  }
  return last || { verified: false, enabled: false, sawControl: false };
}

async function clickExactSaveAndPublish(page, timeoutMs = 6000) {
  const started = Date.now();
  let lastActions = [];
  while (Date.now() - started < timeoutMs) {
    for (const frame of page.frames()) {
      const candidates = [
        frame.getByRole('button', { name: /^Save and publish$/i }).first(),
        frame.getByText(/^Save and publish$/i, { exact: true }).first()
      ];
      for (const candidate of candidates) {
        try {
          if (!(await candidate.count()) || !(await candidate.isVisible()) || await candidate.isDisabled()) continue;
          await candidate.scrollIntoViewIfNeeded().catch(() => {});
          await candidate.click({ force: true, timeout: 5000 });
          return { ok: true, method: 'save-and-publish-locator', label: 'Save and publish' };
        } catch {}
      }

      const clicked = await frame.evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const label = (el) => String(el.innerText || el.textContent || el.value || el.getAttribute?.('aria-label') || '')
          .replace(/\s+/g, ' ').trim();
        const nodes = [...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')]
          .filter(visible);
        const target = nodes.find((el) => /^Save and publish$/i.test(label(el)) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
        if (!target) return false;
        target.scrollIntoView({ block: 'center', inline: 'center' });
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        target.click();
        return true;
      }).catch(() => false);
      if (clicked) return { ok: true, method: 'save-and-publish-dom', label: 'Save and publish' };
    }

    lastActions = await visibleActions(page);
    await wait(250);
  }
  return { ok: false, visibleActions: lastActions };
}

async function clickVerifiedEditorSave(page) {
  const text = await allFramesText(page);
  if (!/Design products/i.test(text) || !/Publish on Spreadshirt/i.test(text) || /Product settings[\s\S]{0,400}Standard placement/i.test(text)) {
    return { ok: false, reason: 'not-design-products-editor' };
  }

  const state = await marketplacePublishingState(page);
  if (!state.verified || !state.enabled) {
    return { ok: false, reason: 'marketplace-not-verified-enabled' };
  }

  for (const frame of page.frames()) {
    const result = await frame.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const label = (el) => String(el.innerText || el.textContent || el.value || el.getAttribute?.('aria-label') || '')
        .replace(/\s+/g, ' ').trim();
      const candidates = [...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')]
        .filter((el) => visible(el) && /^Save$/i.test(label(el)) && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .sort((a, b) => (a.rect.y - b.rect.y) || (b.rect.x - a.rect.x));
      const target = candidates[0]?.el;
      if (!target) return { clicked: false };
      const rect = target.getBoundingClientRect();
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      target.click();
      return { clicked: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }).catch(() => ({ clicked: false }));
    if (result?.clicked) return { ok: true, method: 'verified-marketplace-save', label: 'Save', geometry: result };
  }

  return { ok: false, reason: 'enabled-save-not-found' };
}

function markPublished(featureInstance, projectId, page, options = {}) {
  const publishedAt = new Date().toISOString();
  const publishedUrl = options.url || page.url();
  try { featureInstance.recordPublish(projectId, publishedUrl); } catch {}
  const current = featureInstance.projects.read(projectId);
  const updated = featureInstance.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      status: 'published',
      publishedAt,
      publishedUrl,
      reviewState: options.underReview ? 'under-review' : (current.spreadshirt?.reviewState || null),
      lastError: null
    }
  });
  activity(projectId, options.underReview
    ? 'Spreadshirt confirms the design is published and still under review. Publish counted as successful.'
    : 'Spreadshirt publish completed successfully.');
  return { ok: true, project: updated, publishedAt, url: publishedUrl, usage: featureInstance.usage(), underReview: Boolean(options.underReview) };
}

feature.publish = async function publishFollowingRecordedVideo(projectId) {
  const project = this.projects.read(projectId);
  if (!project.spreadshirt?.preparedAt) {
    throw new Error('Prepare the Spreadshirt listing and complete the final review first.');
  }

  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt publish gate failed: ${gate.errors.join(' ')}`);

  const { page } = await this.sessions.ensureService('spreadshirt');
  await page.bringToFront();
  await this.ensureSignedIn(page);

  let text = await allFramesText(page);
  if (PUBLISHED_UNDER_REVIEW.test(text)) {
    return markPublished(this, projectId, page, { underReview: true });
  }

  const before = await verifyMarketplacePublished(page, project).catch(() => null);
  if (before?.verified && before.published) {
    activity(projectId, 'Marketplace Designs already shows this design as Published. No extra publish click needed.');
    return markPublished(this, projectId, page, { url: before.url });
  }

  if (project.spreadshirt.editorUrl && page.url() !== project.spreadshirt.editorUrl) {
    await page.goto(project.spreadshirt.editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await page.bringToFront();

  activity(projectId, 'Verifying Spreadshirt standard placement is Full front…');
  const placement = await ensureFullFrontPlacement(page);
  activity(projectId, placement.changed
    ? 'Spreadshirt standard placement changed and saved as Full front.'
    : 'Spreadshirt standard placement is already Full front.');

  activity(projectId, 'Verifying “Publish on Spreadshirt” is enabled before final publish…');
  const toggle = await enableMarketplaceCustomToggle(page);
  if (!toggle.ok) {
    throw new Error('Spreadshirt final publish could not enable the “Publish on Spreadshirt” switch.');
  }

  const enabled = await waitForMarketplacePublishingEnabled(page, 7000);
  if (!enabled.verified || !enabled.enabled) {
    const labels = await visibleActions(page);
    throw new Error(`Spreadshirt could not verify that “Publish on Spreadshirt” is ON before saving.${labels.length ? ` Visible actions: ${labels.join(' | ')}` : ''}`);
  }

  activity(projectId, 'Marketplace publishing is confirmed ON. Looking for the final publish action…');
  let action = await clickExactSaveAndPublish(page, 5000);
  if (!action.ok) {
    activity(projectId, 'This Spreadshirt editor keeps the final button labelled “Save”. Because Publish on Spreadshirt is confirmed ON, using that verified Save action…');
    action = await clickVerifiedEditorSave(page);
  }

  if (!action.ok) {
    const labels = await visibleActions(page);
    throw new Error(`Spreadshirt final publish action was not available even though marketplace publishing is ON.${labels.length ? ` Visible actions: ${labels.join(' | ')}` : ''}`);
  }

  activity(projectId, `Clicked Spreadshirt “${action.label}” with marketplace publishing ON. Waiting for publish confirmation…`);
  const started = Date.now();
  while (Date.now() - started < 30000) {
    text = await allFramesText(page);
    if (FAILURE.test(text)) {
      throw new Error(`Spreadshirt showed an error after “${action.label}”.`);
    }
    if (PUBLISHED_UNDER_REVIEW.test(text)) {
      return markPublished(this, projectId, page, { underReview: true });
    }
    if (OTHER_SUCCESS.test(text)) {
      return markPublished(this, projectId, page);
    }
    await wait(300);
  }

  const finalCheck = await verifyMarketplacePublished(page, this.projects.read(projectId)).catch(() => null);
  if (finalCheck?.verified && finalCheck.published) {
    return markPublished(this, projectId, page, { url: finalCheck.url });
  }

  const state = finalCheck?.verified && finalCheck.draft ? ' Marketplace still reports Draft.' : '';
  throw new Error(`Spreadshirt “${action.label}” was clicked with marketplace publishing ON, but the design still could not be verified as Published.${state} The existing Draft is preserved; do not re-upload it.`);
};

module.exports = {
  PUBLISHED_UNDER_REVIEW,
  clickExactSaveAndPublish,
  clickVerifiedEditorSave,
  marketplacePublishingState,
  waitForMarketplacePublishingEnabled,
  allFramesText
};
