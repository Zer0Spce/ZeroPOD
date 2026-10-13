const { feature } = require('./spreadshirtAlphaIpc');
const {
  MARKETPLACE_DESIGNS_URL,
  waitForMarketplaceDesigns
} = require('./spreadshirtMarketplaceRoutePatch');
const {
  designTitleFromFile,
  clearMarketplaceSearch,
  filterMarketplaceByTitle,
  firstMarketplaceCard
} = require('./spreadshirtCardDetectionPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FAILURE_PATTERN = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error|Something went wrong/i;
const SUCCESS_PATTERN = /Well done!|Woohoo!?\s+You[’']ve made it|submitted for review|successfully published|published successfully|publication submitted/i;
const EXCLUDED_ACTION = /cancel|back|delete|discard|remove|duplicate|preview|close/i;

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

async function allFramesText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 1500 });
      if (text) chunks.push(text);
    } catch {}
  }
  return chunks.join('\n');
}

async function visibleActions(frame) {
  return frame.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const label = (el) => String(
      el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.value || ''
    ).replace(/\s+/g, ' ').trim();

    return [...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')]
      .filter(visible)
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
        return {
          index,
          text: label(el).slice(0, 160),
          disabled,
          tag: el.tagName,
          role: el.getAttribute('role') || null,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      })
      .filter((item) => item.text);
  }).catch(() => []);
}

function actionScore(action) {
  const text = String(action?.text || '').trim();
  if (!text || action.disabled || EXCLUDED_ACTION.test(text)) return -1;
  let score = 0;
  if (/save\s*(?:&|and)\s*publish/i.test(text)) score = 100;
  else if (/^publish\s*(?:now|design|changes|to marketplace)?$/i.test(text)) score = 95;
  else if (/publish/i.test(text)) score = 90;
  else if (/^save changes$/i.test(text)) score = 75;
  else if (/^save$/i.test(text)) score = 70;
  else if (/^submit$/i.test(text)) score = 60;
  if (score > 0) score += Math.min(20, Math.max(0, Number(action.y || 0) / 100));
  return score;
}

async function clickActionByGeometry(frame, action) {
  return frame.evaluate((wanted) => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const label = (el) => String(
      el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.value || ''
    ).replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')].filter(visible);
    const target = nodes.find((el) => label(el) === wanted.text && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }, action).catch(() => false);
}

async function findAndClickFinalAction(page, timeoutMs = 15000) {
  const started = Date.now();
  let lastActions = [];
  while (Date.now() - started < timeoutMs) {
    for (const frame of page.frames()) {
      const actions = await visibleActions(frame);
      if (actions.length) lastActions = actions;
      const ranked = actions
        .map((action) => ({ action, score: actionScore(action) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      for (const entry of ranked) {
        if (await clickActionByGeometry(frame, entry.action)) {
          return { ok: true, label: entry.action.text, score: entry.score };
        }
      }
    }
    await wait(300);
  }
  return { ok: false, visibleActions: lastActions.map((item) => item.text).slice(0, 30) };
}

async function clickContinueOrClose(page) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.getByRole('button', { name: /^continue$/i }).first(),
      frame.getByRole('button', { name: /^close$/i }).first(),
      frame.getByText(/^continue$/i, { exact: true }).first()
    ];
    for (const candidate of candidates) {
      if (!(await candidate.count().catch(() => 0))) continue;
      if (!(await candidate.isVisible().catch(() => false))) continue;
      if (await candidate.isDisabled().catch(() => false)) continue;
      await candidate.click({ force: true }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function verifyMarketplacePublished(page, project) {
  const title = project.spreadshirt?.uploadDesignTitle || designTitleFromFile(project.spreadshirt?.pngPath || '');
  if (!title) return { verified: false, reason: 'missing-title' };

  const context = page.context();
  let verifyPage = null;
  try {
    verifyPage = await context.newPage();
    await verifyPage.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForMarketplaceDesigns(verifyPage, 20000).catch(() => {});
    await clearMarketplaceSearch(verifyPage).catch(() => {});
    await filterMarketplaceByTitle(verifyPage, title).catch(() => {});
    await wait(700);
    const card = await firstMarketplaceCard(verifyPage);
    if (!card) return { verified: false, reason: 'card-not-found' };
    const text = String(card.text || '').toLowerCase();
    if (!text.includes(String(title).toLowerCase())) {
      return { verified: false, reason: 'title-mismatch', card };
    }
    if (String(card.status || '').toLowerCase() === 'published' || /\bpublished\b/i.test(card.text || '')) {
      return { verified: true, published: true, card, url: verifyPage.url() };
    }
    if (String(card.status || '').toLowerCase() === 'draft' || /\bdraft\b/i.test(card.text || '')) {
      return { verified: true, published: false, draft: true, card, url: verifyPage.url() };
    }
    return { verified: false, reason: 'unknown-status', card };
  } catch (error) {
    return { verified: false, reason: error.message || String(error) };
  } finally {
    if (verifyPage) await verifyPage.close().catch(() => {});
    await page.bringToFront().catch(() => {});
  }
}

async function completePublishJourney(page, projectId, project) {
  for (let actionNumber = 1; actionNumber <= 2; actionNumber += 1) {
    const action = await findAndClickFinalAction(page, actionNumber === 1 ? 15000 : 8000);
    if (!action.ok) {
      return { ok: false, reason: 'no-action', visibleActions: action.visibleActions || [] };
    }
    activity(projectId, `Clicked Spreadshirt final action: “${action.label}”. Waiting for confirmation…`);

    const started = Date.now();
    while (Date.now() - started < 20000) {
      const text = await allFramesText(page);
      if (FAILURE_PATTERN.test(text)) throw new Error('Spreadshirt showed an error after the final publish action.');
      if (SUCCESS_PATTERN.test(text)) {
        await clickContinueOrClose(page);
        return { ok: true, label: action.label, url: page.url(), method: 'frame-confirmation' };
      }
      await wait(300);
    }

    activity(projectId, 'Spreadshirt confirmation text was unclear. Verifying the design status on Marketplace Designs…');
    const marketplace = await verifyMarketplacePublished(page, project);
    if (marketplace.verified && marketplace.published) {
      activity(projectId, 'Marketplace Designs confirms the design is Published.');
      return { ok: true, label: action.label, url: marketplace.url || page.url(), method: 'marketplace-verified' };
    }
    if (marketplace.verified && marketplace.draft) {
      activity(projectId, 'Marketplace Designs still shows this design as Draft. Retrying only the final publish action…');
    } else {
      activity(projectId, `Could not conclusively verify Marketplace status${marketplace.reason ? ` (${marketplace.reason})` : ''}.`, 'spreadshirt-error');
    }

    // A Save/Save changes can reveal a separate Publish action. Also allow one
    // additional bounded final-action pass when Marketplace still shows Draft.
    if (actionNumber >= 2) break;
  }

  return { ok: false, reason: 'unverified' };
}

function markPublished(featureInstance, projectId, page, publishedUrl) {
  const publishedAt = new Date().toISOString();
  featureInstance.recordPublish(projectId, publishedUrl || page.url());
  const current = featureInstance.projects.read(projectId);
  const updated = featureInstance.projects.update(projectId, {
    spreadshirt: {
      ...(current.spreadshirt || {}),
      status: 'published',
      publishedAt,
      publishedUrl: publishedUrl || page.url(),
      lastError: null
    }
  });
  activity(projectId, 'Spreadshirt publish flow completed successfully.');
  return { ok: true, project: updated, publishedAt, url: publishedUrl || page.url(), usage: featureInstance.usage() };
}

const previousPublish = feature.publish.bind(feature);
feature.publish = async function publishWithCurrentFinalAction(projectId) {
  try {
    return await previousPublish(projectId);
  } catch (error) {
    const message = String(error?.message || error || '');
    if (!/Save and publish.*not found|button was not found|final publish control could not be completed|publish result could not be verified/i.test(message)) throw error;

    const project = this.projects.read(projectId);
    if (!project.spreadshirt?.preparedAt) throw error;
    const { page } = await this.sessions.ensureService('spreadshirt');
    await page.bringToFront();
    await this.ensureSignedIn(page);

    // Before clicking anything again, verify whether the prior attempt actually published.
    activity(projectId, 'Checking whether the previous Spreadshirt publish attempt already succeeded…');
    const precheck = await verifyMarketplacePublished(page, project);
    if (precheck.verified && precheck.published) {
      activity(projectId, 'The design is already Published on Spreadshirt. No additional publish click is needed.');
      return markPublished(this, projectId, page, precheck.url);
    }

    if (project.spreadshirt.editorUrl && page.url() !== project.spreadshirt.editorUrl) {
      await page.goto(project.spreadshirt.editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    await page.bringToFront();

    activity(projectId, 'Detecting the current visible Save/Publish control in the prepared Spreadshirt editor…');
    const result = await completePublishJourney(page, projectId, project);
    if (!result.ok) {
      const finalCheck = await verifyMarketplacePublished(page, project);
      if (finalCheck.verified && finalCheck.published) {
        activity(projectId, 'Final Marketplace verification confirms the design is Published.');
        return markPublished(this, projectId, page, finalCheck.url);
      }
      const details = result.visibleActions?.length ? ` Visible actions: ${result.visibleActions.join(' | ')}` : '';
      const state = finalCheck.verified && finalCheck.draft ? ' Marketplace status: Draft.' : '';
      throw new Error(`Spreadshirt final publish control could not be completed.${state}${details}`);
    }

    return markPublished(this, projectId, page, result.url);
  }
};

module.exports = {
  allFramesText,
  visibleActions,
  actionScore,
  findAndClickFinalAction,
  verifyMarketplacePublished,
  completePublishJourney
};
