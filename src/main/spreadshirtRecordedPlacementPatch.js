const { feature } = require('./spreadshirtAlphaIpc');
const videoFlow = require('./spreadshirtVideoFlowPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PUBLISHED_UNDER_REVIEW = /Your design has been published, but is still under review/i;

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

async function pageText(page) {
  const texts = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 1000 });
      if (text) texts.push(text);
    } catch {}
  }
  return texts.join('\n');
}

async function visible(locator) {
  try { return Boolean(await locator.count()) && await locator.isVisible(); } catch { return false; }
}

async function clickVisibleText(page, pattern) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.getByRole('button', { name: pattern }).first(),
      frame.getByRole('link', { name: pattern }).first(),
      frame.getByText(pattern, { exact: true }).first()
    ];
    for (const candidate of candidates) {
      if (!(await visible(candidate))) continue;
      if (await candidate.isDisabled().catch(() => false)) continue;
      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      await candidate.click({ force: true, timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function ensureFullFrontPlacement(page, projectId) {
  const text = await pageText(page);
  if (/Standard placement[\s\S]{0,160}Full front/i.test(text) && !/Product settings/i.test(text)) {
    activity(projectId, 'Spreadshirt standard placement is already Full front.');
    return true;
  }

  activity(projectId, 'Setting Spreadshirt standard placement to Full front…');

  if (!/Product settings/i.test(text)) {
    const opened = await clickVisibleText(page, /^Change settings$/i);
    if (!opened) throw new Error('Spreadshirt “Change settings” control was not found in Products.');
  }

  const settingsStarted = Date.now();
  while (Date.now() - settingsStarted < 15000) {
    const current = await pageText(page);
    if (/Product settings/i.test(current) && /Standard placement/i.test(current)) break;
    await wait(250);
  }

  const settingsText = await pageText(page);
  if (!/Product settings/i.test(settingsText) || !/Standard placement/i.test(settingsText)) {
    throw new Error('Spreadshirt Product settings did not open.');
  }

  // The current UI exposes a visible card labelled “Full front”. Click the visible
  // label/card rather than a hidden radio input, matching the recorded manual flow.
  let selected = false;
  for (const frame of page.frames()) {
    const label = frame.getByText(/^Full front$/i, { exact: true }).first();
    if (!(await visible(label))) continue;
    selected = await label.evaluate((el) => {
      const root = el.closest('label,button,[role="button"],[role="radio"],[class*="placement" i],[class*="option" i],li,div') || el;
      try { root.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      try {
        root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        root.click();
        return true;
      } catch {
        return false;
      }
    }).catch(() => false);
    if (selected) break;
  }
  if (!selected) throw new Error('Spreadshirt “Full front” placement option was not found.');

  await wait(350);
  const saved = await clickVisibleText(page, /^Save$/i);
  if (!saved) throw new Error('Spreadshirt Product settings “Save” button was not found.');

  const returnedStarted = Date.now();
  while (Date.now() - returnedStarted < 20000) {
    const current = await pageText(page);
    if (/Design products/i.test(current) && /Standard placement[\s\S]{0,180}Full front/i.test(current)) {
      activity(projectId, 'Spreadshirt standard placement saved as Full front.');
      // Product generation restarts after changing placement. Wait for it to settle.
      await videoFlow.waitForProductsCreated(page, 45000);
      return true;
    }
    await wait(300);
  }

  throw new Error('Spreadshirt did not confirm Full front as the standard placement after Save.');
}

// Patch the exported product-readiness helper BEFORE spreadshirtCardDetectionPatch
// imports it. Any normal/resume prepare path that waits for products will also set
// the recorded Full front placement before metadata/final review.
const originalWaitForProductsCreated = videoFlow.waitForProductsCreated;
videoFlow.waitForProductsCreated = async function waitForProductsCreatedWithFullFront(page, timeoutMs = 45000) {
  const result = await originalWaitForProductsCreated(page, timeoutMs);
  let projectId = null;
  try {
    // The active project is not part of the helper signature, so callers can still
    // set placement safely even when Activity logging has no project id here.
    projectId = feature.activeProjectId || null;
  } catch {}
  await ensureFullFrontPlacement(page, projectId).catch((error) => {
    if (projectId) activity(projectId, `Spreadshirt Full front placement failed: ${error.message || error}`, 'spreadshirt-error');
    throw error;
  });
  return result;
};

// Accept Spreadshirt's exact recorded success banner as a successful publication.
const previousPublish = feature.publish.bind(feature);
feature.publish = async function publishAcceptingUnderReview(projectId) {
  try {
    return await previousPublish(projectId);
  } catch (error) {
    const project = this.projects.read(projectId);
    if (!project?.spreadshirt?.preparedAt) throw error;
    const { page } = await this.sessions.ensureService('spreadshirt');
    const text = await pageText(page);
    if (!PUBLISHED_UNDER_REVIEW.test(text)) throw error;

    const publishedAt = new Date().toISOString();
    try { this.recordPublish(projectId, page.url()); } catch {}
    const current = this.projects.read(projectId);
    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(current.spreadshirt || {}),
        status: 'published',
        publishedAt,
        publishedUrl: page.url(),
        reviewState: 'under-review',
        lastError: null
      }
    });
    activity(projectId, 'Spreadshirt confirms the design is published and under review. Marking publish successful.');
    return { ok: true, project: updated, publishedAt, url: page.url(), usage: this.usage(), underReview: true };
  }
};

module.exports = {
  ensureFullFrontPlacement,
  PUBLISHED_UNDER_REVIEW
};
