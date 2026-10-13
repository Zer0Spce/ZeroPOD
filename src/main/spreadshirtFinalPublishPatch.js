const { feature } = require('./spreadshirtAlphaIpc');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FAILURE_PATTERN = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error|Something went wrong/i;
const SUCCESS_PATTERN = /Well done!|Woohoo!?\s+You[’']ve made it|submitted for review|successfully published|published successfully|publication submitted/i;
const EXCLUDED_ACTION = /cancel|back|delete|discard|remove|duplicate|preview|close/i;

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
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

async function completePublishJourney(page, projectId) {
  for (let actionNumber = 1; actionNumber <= 2; actionNumber += 1) {
    const action = await findAndClickFinalAction(page, actionNumber === 1 ? 15000 : 8000);
    if (!action.ok) {
      return { ok: false, reason: 'no-action', visibleActions: action.visibleActions || [] };
    }
    activity(projectId, `Clicked Spreadshirt final action: “${action.label}”. Waiting for confirmation…`);

    const started = Date.now();
    while (Date.now() - started < 20000) {
      const text = await bodyText(page);
      if (FAILURE_PATTERN.test(text)) throw new Error('Spreadshirt showed an error after the final publish action.');
      if (SUCCESS_PATTERN.test(text)) {
        await clickContinueOrClose(page);
        return { ok: true, label: action.label, url: page.url() };
      }
      if (/Well done!/i.test(text)) {
        await clickContinueOrClose(page);
        await wait(500);
        const nextText = await bodyText(page);
        if (SUCCESS_PATTERN.test(nextText) || /Woohoo/i.test(nextText)) {
          await clickContinueOrClose(page);
          return { ok: true, label: action.label, url: page.url() };
        }
      }
      await wait(300);
    }

    // A plain Save/Save changes can reveal a separate Publish action. Allow one
    // additional bounded final-action pass before giving up.
    if (!/^save(?: changes)?$/i.test(action.label)) break;
  }

  return { ok: false, reason: 'unverified' };
}

const previousPublish = feature.publish.bind(feature);
feature.publish = async function publishWithCurrentFinalAction(projectId) {
  try {
    return await previousPublish(projectId);
  } catch (error) {
    const message = String(error?.message || error || '');
    if (!/Save and publish.*not found|button was not found/i.test(message)) throw error;

    const project = this.projects.read(projectId);
    if (!project.spreadshirt?.preparedAt) throw error;
    const { page } = await this.sessions.ensureService('spreadshirt');
    if (project.spreadshirt.editorUrl && page.url() !== project.spreadshirt.editorUrl) {
      await page.goto(project.spreadshirt.editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    await page.bringToFront();
    await this.ensureSignedIn(page);

    activity(projectId, 'Spreadshirt uses a different final action on this editor. Detecting the visible Save/Publish control…');
    const result = await completePublishJourney(page, projectId);
    if (!result.ok) {
      const details = result.visibleActions?.length ? ` Visible actions: ${result.visibleActions.join(' | ')}` : '';
      throw new Error(`Spreadshirt final publish control could not be completed.${details}`);
    }

    const publishedAt = new Date().toISOString();
    this.recordPublish(projectId, page.url());
    const current = this.projects.read(projectId);
    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(current.spreadshirt || {}),
        status: 'published',
        publishedAt,
        publishedUrl: page.url(),
        lastError: null
      }
    });
    activity(projectId, 'Spreadshirt publish flow completed successfully.');
    return { ok: true, project: updated, publishedAt, url: page.url(), usage: this.usage() };
  }
};

module.exports = {
  visibleActions,
  actionScore,
  findAndClickFinalAction,
  completePublishJourney
};
