const fs = require('fs');
const path = require('path');
const { SpreadshirtAlphaFeature } = require('./spreadshirtAlphaFeature');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function visible(locator) {
  try {
    return Boolean(await locator.count()) && await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function fieldFromLabel(frame, patterns) {
  for (const pattern of patterns) {
    const labelled = frame.getByLabel(pattern).first();
    if (await visible(labelled)) return labelled;

    const label = frame.locator('label').filter({ hasText: pattern }).first();
    if (await visible(label)) {
      const forId = await label.getAttribute('for').catch(() => null);
      if (forId) {
        const escaped = String(forId).replace(/([ #;.?+*~\':"!^$[\]()=>|/@])/g, '\\$1');
        const target = frame.locator(`#${escaped}`).first();
        if (await visible(target)) return target;
      }
      const nested = label.locator('input, textarea, [contenteditable="true"]').first();
      if (await visible(nested)) return nested;
      const nearby = label.locator('xpath=ancestor::*[self::div or self::section or self::fieldset][1]//input | xpath=ancestor::*[self::div or self::section or self::fieldset][1]//textarea | xpath=ancestor::*[self::div or self::section or self::fieldset][1]//*[@contenteditable="true"]').first();
      if (await visible(nearby)) return nearby;
    }
  }
  return null;
}

async function fieldFromSelectors(frame, selectors) {
  for (const selector of selectors) {
    const field = frame.locator(selector).first();
    if (await visible(field)) return field;
  }
  return null;
}

async function findFieldsInFrame(frame) {
  const title = await fieldFromLabel(frame, [/design name/i, /^name$/i, /design title/i, /^title$/i]) || await fieldFromSelectors(frame, [
    'input[aria-label*="design name" i]',
    'input[aria-label*="title" i]',
    'input[placeholder*="design name" i]',
    'input[placeholder*="title" i]',
    'input[name*="designName" i]',
    'input[name*="design-name" i]',
    'input[name*="title" i]',
    'input[id*="designName" i]',
    'input[id*="title" i]'
  ]);

  const description = await fieldFromLabel(frame, [/description/i]) || await fieldFromSelectors(frame, [
    'textarea[aria-label*="description" i]',
    'textarea[placeholder*="description" i]',
    'textarea[name*="description" i]',
    'textarea[id*="description" i]',
    '[contenteditable="true"][aria-label*="description" i]',
    '[contenteditable="true"][data-placeholder*="description" i]'
  ]);

  const keywords = await fieldFromLabel(frame, [/keywords?/i, /tags?/i]) || await fieldFromSelectors(frame, [
    'input[aria-label*="keyword" i]',
    'input[aria-label*="tag" i]',
    'input[placeholder*="keyword" i]',
    'input[placeholder*="tag" i]',
    'input[name*="keyword" i]',
    'input[name*="tag" i]',
    'textarea[aria-label*="keyword" i]',
    'textarea[aria-label*="tag" i]',
    'textarea[name*="keyword" i]',
    'textarea[name*="tag" i]',
    '[contenteditable="true"][aria-label*="keyword" i]',
    '[contenteditable="true"][aria-label*="tag" i]'
  ]);

  return title && description && keywords ? { frame, title, description, keywords } : null;
}

async function locateMetadataFields(page) {
  for (const frame of page.frames()) {
    const fields = await findFieldsInFrame(frame);
    if (fields) return fields;
  }
  return null;
}

async function clickFirstJourneyAction(page) {
  const patterns = [
    /^continue$/i,
    /^next$/i,
    /^proceed$/i,
    /^done$/i,
    /continue to details/i,
    /edit details/i,
    /add details/i,
    /design details/i,
    /edit design/i,
    /add information/i,
    /listing details/i,
    /edit metadata/i,
    /add metadata/i
  ];

  for (const frame of page.frames()) {
    for (const pattern of patterns) {
      const candidates = [
        frame.getByRole('button', { name: pattern }).first(),
        frame.getByRole('link', { name: pattern }).first(),
        frame.getByText(pattern, { exact: true }).first()
      ];
      for (const candidate of candidates) {
        if (!(await visible(candidate))) continue;
        const disabled = await candidate.isDisabled().catch(() => false);
        if (disabled) continue;
        await candidate.click({ force: true }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

async function selectMarketplaceIfExplicitlyRequired(page) {
  for (const frame of page.frames()) {
    const checkbox = frame.getByRole('checkbox', { name: /marketplace/i }).first();
    if (await visible(checkbox)) {
      const checked = await checkbox.isChecked().catch(() => true);
      if (!checked) {
        await checkbox.check({ force: true }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

async function waitForMetadataEditor(page, timeoutMs = 45000) {
  const started = Date.now();
  let lastActionAt = 0;
  while (Date.now() - started < timeoutMs) {
    const fields = await locateMetadataFields(page);
    if (fields) return fields;

    const body = await page.locator('body').innerText().catch(() => '');
    if (/captcha|verify you are human|are you human|cloudflare/i.test(body)) {
      throw new Error('Spreadshirt is showing a human-verification challenge. Complete it manually in the browser, then retry Prepare.');
    }

    if (Date.now() - lastActionAt > 1200) {
      const selectedMarketplace = await selectMarketplaceIfExplicitlyRequired(page);
      const advanced = selectedMarketplace || await clickFirstJourneyAction(page);
      if (advanced) {
        lastActionAt = Date.now();
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await wait(900);
        continue;
      }
    }
    await wait(700);
  }

  const diagnostics = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const actions = [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(visible)
      .map((el) => String(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim())
      .filter(Boolean)
      .slice(0, 30);
    const fields = [...document.querySelectorAll('input,textarea,[contenteditable="true"]')]
      .filter(visible)
      .map((el) => [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('placeholder'), el.getAttribute('aria-label')].filter(Boolean).join(' / '))
      .filter(Boolean)
      .slice(0, 20);
    return { actions, fields, text: String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 900) };
  }).catch(() => ({ actions: [], fields: [], text: '' }));

  throw new Error(`Spreadshirt metadata editor was not reached after upload. Page: ${page.url()}. Visible actions: ${diagnostics.actions.join(' | ') || 'none'}. Visible fields: ${diagnostics.fields.join(' | ') || 'none'}. Page text: ${diagnostics.text || 'unavailable'}`);
}

async function fillTextField(locator, value) {
  await locator.click({ force: true }).catch(() => {});
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
  if (tag === 'input' || tag === 'textarea') {
    await locator.fill(String(value));
  } else {
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await locator.type(String(value));
  }
}

async function fillKeywords(locator, keywords) {
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
  const values = [...new Set((keywords || []).map((v) => String(v || '').trim()).filter(Boolean))];
  await locator.click({ force: true }).catch(() => {});

  if (tag === 'textarea') {
    await locator.fill(values.join(', '));
    return;
  }

  await locator.fill('').catch(async () => {
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await locator.press('Backspace').catch(() => {});
  });

  for (const keyword of values) {
    await locator.fill(keyword).catch(async () => {
      await locator.type(keyword);
    });
    await locator.press('Enter').catch(() => {});
    await wait(90);
  }
}

SpreadshirtAlphaFeature.prototype.fillMetadata = async function fillMetadataReliable(page, metadata) {
  const fields = await waitForMetadataEditor(page, 45000);
  await fillTextField(fields.title, metadata.title);
  await fillTextField(fields.description, metadata.description);
  await fillKeywords(fields.keywords, metadata.keywords);
  return true;
};

const previousPrepare = SpreadshirtAlphaFeature.prototype.prepare;
SpreadshirtAlphaFeature.prototype.prepare = async function prepareWithReviewCapture(projectId) {
  const result = await previousPrepare.call(this, projectId);
  try {
    const { page } = await this.sessions.ensureService('spreadshirt');
    const screenshotPath = path.join(this.projects.getProjectDir(projectId), 'spreadshirt-final-review.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    if (fs.existsSync(screenshotPath)) {
      const project = this.projects.read(projectId);
      const updated = this.projects.update(projectId, {
        spreadshirt: {
          ...(project.spreadshirt || {}),
          reviewScreenshotPath: screenshotPath,
          editorUrl: page.url()
        }
      });
      return { ...result, project: updated, reviewScreenshotPath: screenshotPath };
    }
  } catch {}
  return result;
};

module.exports = { waitForMetadataEditor, locateMetadataFields };
