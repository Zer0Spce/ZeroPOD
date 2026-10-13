const { feature } = require('./spreadshirtAlphaIpc');
const { enableMarketplaceCustomToggle } = require('./spreadshirtMarketplaceTogglePatch');
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

async function clickExactSaveAndPublish(page, timeoutMs = 20000) {
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
          return { ok: true, method: 'locator' };
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
      if (clicked) return { ok: true, method: 'dom-exact-text' };
    }

    lastActions = await visibleActions(page);
    await wait(250);
  }
  return { ok: false, visibleActions: lastActions };
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

  // If a previous attempt silently succeeded, honor the real Marketplace status and
  // do not click publish again.
  const before = await verifyMarketplacePublished(page, project).catch(() => null);
  if (before?.verified && before.published) {
    activity(projectId, 'Marketplace Designs already shows this design as Published. No extra publish click needed.');
    return markPublished(this, projectId, page, { url: before.url });
  }

  if (project.spreadshirt.editorUrl && page.url() !== project.spreadshirt.editorUrl) {
    await page.goto(project.spreadshirt.editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await page.bringToFront();

  // The recorded manual flow changes Product settings first. Enforce Full front here
  // too so an already-prepared project from an older Alpha build is corrected without
  // restarting generation/upload.
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

  // The recorded UI changes the top-right button from “Save” to “Save and publish”
  // only after the marketplace switch is really enabled. Never fall back to plain Save.
  activity(projectId, 'Waiting for the recorded top-right “Save and publish” button…');
  const action = await clickExactSaveAndPublish(page, 20000);
  if (!action.ok) {
    const labels = action.visibleActions?.length ? ` Visible actions: ${action.visibleActions.join(' | ')}` : '';
    throw new Error(`Spreadshirt “Save and publish” did not become available after enabling marketplace publishing.${labels}`);
  }

  activity(projectId, 'Clicked Spreadshirt “Save and publish”. Waiting for publish confirmation…');
  const started = Date.now();
  while (Date.now() - started < 30000) {
    text = await allFramesText(page);
    if (FAILURE.test(text)) {
      throw new Error('Spreadshirt showed an error after “Save and publish”.');
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

  throw new Error('Spreadshirt “Save and publish” was clicked, but the design still could not be verified as Published. The existing Draft is preserved; do not re-upload it.');
};

module.exports = {
  PUBLISHED_UNDER_REVIEW,
  clickExactSaveAndPublish,
  allFramesText
};
