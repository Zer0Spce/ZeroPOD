const { feature } = require('./spreadshirtAlphaIpc');
const { marketplaceState, clickMarketplaceVisibleControl } = require('./spreadshirtMarketplaceTogglePatch');
const { verifyMarketplacePublished } = require('./spreadshirtFinalPublishPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PUBLISHED_UNDER_REVIEW = /Your design has been published, but is still under review|Design status\s*In review/i;
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

async function findMarketplaceState(page) {
  for (const frame of page.frames()) {
    const state = await marketplaceState(frame);
    if (state) return { frame, state };
  }
  return null;
}

async function ensurePublishSwitchOn(page, projectId) {
  const started = Date.now();
  let found = null;
  while (Date.now() - started < 12000) {
    found = await findMarketplaceState(page);
    if (found) break;
    await wait(250);
  }
  if (!found) throw new Error('Spreadshirt “Publish on Spreadshirt” control was not found on the final review page.');

  if (found.state.checked === true) {
    activity(projectId, 'Publish on Spreadshirt is already ON. Waiting for Save and publish…');
    return true;
  }

  activity(projectId, 'Clicking Publish on Spreadshirt first so the final Save and publish action becomes available…');
  const click = await clickMarketplaceVisibleControl(found.frame);
  if (!click?.clicked && !click?.alreadyChecked) {
    throw new Error('Spreadshirt “Publish on Spreadshirt” control could not be activated.');
  }

  const verifyStarted = Date.now();
  while (Date.now() - verifyStarted < 8000) {
    const current = await marketplaceState(found.frame);
    if (current?.checked === true) return true;
    await wait(200);
  }

  throw new Error('Spreadshirt “Publish on Spreadshirt” was clicked, but ZeroPOD could not verify that it turned ON.');
}

async function clickSaveAndPublish(page, timeoutMs = 15000) {
  const started = Date.now();
  let actions = [];
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
          return { ok: true };
        } catch {}
      }
    }

    actions = [];
    for (const frame of page.frames()) {
      const labels = await frame.evaluate(() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        return [...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')]
          .filter(visible)
          .map((el) => String(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 30);
      }).catch(() => []);
      actions.push(...labels);
    }
    await wait(250);
  }
  return { ok: false, visibleActions: [...new Set(actions)].slice(0, 40) };
}

function markPublished(projectId, page, underReview = false, url = null) {
  const publishedAt = new Date().toISOString();
  try { feature.recordPublish(projectId, url || page.url()); } catch {}
  const current = feature.projects.read(projectId);
  const updated = feature.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      status: 'published',
      publishedAt,
      publishedUrl: url || page.url(),
      reviewState: underReview ? 'under-review' : (current.spreadshirt?.reviewState || null),
      lastError: null
    }
  });
  activity(projectId, underReview
    ? 'Spreadshirt confirms the design is published and currently In review. Publish counted as successful.'
    : 'Spreadshirt publish completed successfully.');
  return { ok: true, project: updated, publishedAt, url: url || page.url(), usage: feature.usage(), underReview };
}

feature.publish = async function publishWithExactFinalApprovalSequence(projectId) {
  const project = this.projects.read(projectId);
  if (!project.spreadshirt?.preparedAt) throw new Error('Prepare the Spreadshirt listing and complete the final review first.');

  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt publish gate failed: ${gate.errors.join(' ')}`);

  const { page } = await this.sessions.ensureService('spreadshirt');
  await page.bringToFront();
  await this.ensureSignedIn(page);

  let text = await allFramesText(page);
  if (PUBLISHED_UNDER_REVIEW.test(text)) return markPublished(projectId, page, true);

  const before = await verifyMarketplacePublished(page, project).catch(() => null);
  if (before?.verified && before.published) {
    activity(projectId, 'Marketplace already shows this design as Published. No extra publish click needed.');
    return markPublished(projectId, page, false, before.url);
  }

  if (project.spreadshirt.editorUrl && page.url() !== project.spreadshirt.editorUrl) {
    await page.goto(project.spreadshirt.editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await page.bringToFront();

  // Important: Full-front placement is a Prepare-stage responsibility. Do not reopen
  // Product settings here; live final-review pages may not expose Change settings.
  await ensurePublishSwitchOn(page, projectId);

  activity(projectId, 'Waiting for Spreadshirt “Save and publish”…');
  const action = await clickSaveAndPublish(page, 15000);
  if (!action.ok) {
    const labels = action.visibleActions?.length ? ` Visible actions: ${action.visibleActions.join(' | ')}` : '';
    throw new Error(`Spreadshirt “Save and publish” did not appear after activating Publish on Spreadshirt.${labels}`);
  }

  activity(projectId, 'Clicked Spreadshirt “Save and publish”. Waiting for publication status…');
  const started = Date.now();
  while (Date.now() - started < 30000) {
    text = await allFramesText(page);
    if (FAILURE.test(text)) throw new Error('Spreadshirt showed an error after Save and publish.');
    if (PUBLISHED_UNDER_REVIEW.test(text)) return markPublished(projectId, page, true);
    await wait(300);
  }

  const finalCheck = await verifyMarketplacePublished(page, this.projects.read(projectId)).catch(() => null);
  if (finalCheck?.verified && finalCheck.published) return markPublished(projectId, page, false, finalCheck.url);

  throw new Error('Spreadshirt Save and publish was clicked, but the design could not be verified as Published. The existing Draft is preserved and will not be re-uploaded.');
};

module.exports = {
  ensurePublishSwitchOn,
  clickSaveAndPublish,
  PUBLISHED_UNDER_REVIEW
};
