const fs = require('fs');
const path = require('path');
const {
  SpreadshirtAlphaFeature,
  SPREADSHIRT_DESIGNS_URL
} = require('./spreadshirtAlphaFeature');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UPLOAD_ERROR_PATTERN = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error occured|Unfortunately, an error occurred/i;
const HUMAN_CHECK_PATTERN = /captcha|verify you are human|are you human|cloudflare/i;

async function visible(locator) {
  try {
    return Boolean(await locator.count()) && await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
}

async function clickFirst(candidates) {
  for (const candidate of candidates) {
    if (!(await visible(candidate))) continue;
    if (await candidate.isDisabled().catch(() => false)) continue;
    await candidate.click({ force: true });
    return true;
  }
  return false;
}

async function getDesignCards(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 70 && rect.height > 70 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const rows = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      if (!isVisible(a)) continue;
      let url;
      try { url = new URL(a.href, location.href); } catch { continue; }
      if (!/\/designs\//i.test(url.pathname)) continue;
      if (!a.querySelector('img,svg,picture,[style*="background-image"]')) continue;
      const key = `${url.href}|${String(a.innerText || '').trim().slice(0, 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ href: url.href, key, text: String(a.innerText || '').trim() });
    }
    return rows;
  }).catch(() => []);
}

async function openCreateNewDialog(page) {
  const clicked = await clickFirst([
    page.getByRole('button', { name: /create new/i }).first(),
    page.getByRole('link', { name: /create new/i }).first(),
    page.getByText(/create new/i, { exact: true }).first()
  ]);
  if (!clicked) throw new Error('Spreadshirt “Create New” button was not found on the Designs page.');

  const started = Date.now();
  while (Date.now() - started < 10000) {
    const text = await bodyText(page);
    if (/Upload design/i.test(text) && /Select file|Browse/i.test(text)) return true;
    await wait(250);
  }
  throw new Error('Spreadshirt “Upload design” dialog did not open after Create New.');
}

async function selectFileLikeVideo(page, file) {
  const dialog = page.getByRole('dialog').filter({ hasText: /Upload design/i }).first();
  const scope = await visible(dialog) ? dialog : page;

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null);
  const clicked = await clickFirst([
    scope.getByRole('button', { name: /select file/i }).first(),
    scope.getByRole('button', { name: /browse/i }).first(),
    scope.getByText(/select file/i, { exact: true }).first()
  ]);

  if (clicked) {
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(file);
      return 'filechooser';
    }
  }

  const scopedInputs = scope.locator('input[type="file"]');
  const count = await scopedInputs.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const input = scopedInputs.nth(index);
    try {
      await input.setInputFiles(file);
      return 'dialog-input';
    } catch {}
  }

  throw new Error('Spreadshirt “Select file” upload control was not usable.');
}

async function waitForUploadResult(page, timeoutMs = 60000) {
  const started = Date.now();
  let sawUploadStatus = false;
  while (Date.now() - started < timeoutMs) {
    const text = await bodyText(page);
    if (HUMAN_CHECK_PATTERN.test(text)) {
      throw new Error('Spreadshirt is showing a human-verification challenge. Complete it manually, then retry.');
    }
    if (UPLOAD_ERROR_PATTERN.test(text)) {
      throw new Error('Spreadshirt showed “Ooops! Snap. It didn’t work.” during the upload.');
    }
    if (/Upload status/i.test(text)) sawUploadStatus = true;
    if (/Upload successful/i.test(text)) return { ok: true, sawUploadStatus };
    await wait(350);
  }
  throw new Error(`Spreadshirt did not report “Upload successful” within ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function clickUploadedDesign(page, beforeCards, timeoutMs = 30000) {
  const beforeKeys = new Set((beforeCards || []).map((card) => card.key));
  const beforeHrefs = new Set((beforeCards || []).map((card) => card.href));
  const started = Date.now();
  let fallback = null;

  while (Date.now() - started < timeoutMs) {
    const text = await bodyText(page);
    if (UPLOAD_ERROR_PATTERN.test(text)) throw new Error('Spreadshirt returned to the Designs page with an upload error.');
    const cards = await getDesignCards(page);
    const fresh = cards.find((card) => !beforeKeys.has(card.key) || !beforeHrefs.has(card.href));
    fallback = fresh || cards[0] || fallback;

    if (fresh) {
      await page.goto(fresh.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(async () => {
        await page.evaluate((href) => {
          const node = [...document.querySelectorAll('a[href]')].find((a) => a.href === href);
          node?.click();
        }, fresh.href);
      });
      return fresh;
    }

    await wait(500);
  }

  if (fallback) {
    await page.goto(fallback.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(async () => {
      await page.evaluate((href) => {
        const node = [...document.querySelectorAll('a[href]')].find((a) => a.href === href);
        node?.click();
      }, fallback.href);
    });
    return fallback;
  }

  throw new Error('Spreadshirt upload succeeded, but the new design card never appeared on the Designs page.');
}

async function waitForDesignEditor(page, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await bodyText(page);
    if (HUMAN_CHECK_PATTERN.test(text)) throw new Error('Spreadshirt is showing a human-verification challenge in the design editor.');
    if (/Design products/i.test(text) && /Products/i.test(text) && /Metadata/i.test(text)) return true;
    await wait(400);
  }
  throw new Error(`Spreadshirt did not open the “Design products” editor. Current page: ${page.url()}`);
}

async function waitForProductsCreated(page, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await bodyText(page);
    if (/\b\d+\s+products created\b/i.test(text)) return true;
    if (/Metadata/i.test(text) && /Publish on Spreadshirt/i.test(text) && Date.now() - started > 10000) return true;
    await wait(500);
  }
  return false;
}

async function enableSpreadshirtMarketplace(page) {
  for (const frame of page.frames()) {
    const textBlock = frame.getByText(/Publish on Spreadshirt/i, { exact: true }).first();
    if (!(await visible(textBlock))) continue;

    const container = textBlock.locator('xpath=ancestor::*[self::section or self::div][1]');
    const switches = container.locator('[role="switch"], input[type="checkbox"]');
    const count = await switches.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const toggle = switches.nth(index);
      if (!(await toggle.isVisible().catch(() => false))) continue;
      const role = await toggle.getAttribute('role').catch(() => null);
      if (role === 'switch') {
        const checked = (await toggle.getAttribute('aria-checked').catch(() => null)) === 'true';
        if (!checked) await toggle.click({ force: true });
        return true;
      }
      const checked = await toggle.isChecked().catch(() => false);
      if (!checked) await toggle.check({ force: true }).catch(() => toggle.click({ force: true }));
      return true;
    }
  }

  for (const frame of page.frames()) {
    const row = frame.locator('div,section').filter({ hasText: /Spreadshirt marketplace|Publish on Spreadshirt/i }).first();
    if (!(await visible(row))) continue;
    const toggle = row.locator('[role="switch"], input[type="checkbox"]').first();
    if (!(await toggle.count().catch(() => 0))) continue;
    const role = await toggle.getAttribute('role').catch(() => null);
    if (role === 'switch') {
      if ((await toggle.getAttribute('aria-checked').catch(() => 'false')) !== 'true') await toggle.click({ force: true });
    } else if (!(await toggle.isChecked().catch(() => false))) {
      await toggle.check({ force: true }).catch(() => toggle.click({ force: true }));
    }
    return true;
  }

  return false;
}

function activity(feature, projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

async function performRecordedUploadFlow(feature, page, file, projectId) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let uploadSucceeded = false;
    try {
      activity(feature, projectId, `Spreadshirt upload attempt ${attempt}: opening Designs and Create New…`);
      await feature.openDesigns(page);
      await page.bringToFront();
      const beforeCards = await getDesignCards(page);

      await openCreateNewDialog(page);
      activity(feature, projectId, 'Spreadshirt Upload Design dialog opened. Selecting the regular 4500×5400 PNG…');
      await selectFileLikeVideo(page, file);
      activity(feature, projectId, 'Artwork selected. Waiting for Spreadshirt Upload Status…');
      await waitForUploadResult(page, 60000);
      uploadSucceeded = true;
      activity(feature, projectId, 'Spreadshirt reported “Upload successful”. Waiting for the new design card…');

      const modal = page.getByRole('dialog').filter({ hasText: /Upload status/i }).first();
      if (await visible(modal)) await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      if (!/\/designs(?:[/?#]|$)/i.test(page.url())) {
        await page.goto(SPREADSHIRT_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      }

      const card = await clickUploadedDesign(page, beforeCards, 30000);
      activity(feature, projectId, `Opening uploaded Spreadshirt design${card?.text ? `: ${card.text.slice(0, 60)}` : ''}…`);
      await waitForDesignEditor(page, 45000);
      activity(feature, projectId, 'Spreadshirt Design products editor opened. Waiting for product creation…');
      await waitForProductsCreated(page, 45000);
      return true;
    } catch (error) {
      lastError = error;
      if (uploadSucceeded) {
        throw new Error(`Spreadshirt upload succeeded, but ZeroPOD could not continue to the design editor: ${error.message || error}`);
      }
      if (HUMAN_CHECK_PATTERN.test(String(error?.message || error))) throw error;
      activity(feature, projectId, `Spreadshirt upload attempt ${attempt} failed: ${error.message || error}`, 'spreadshirt-error');
      if (attempt < 2) {
        await page.goto(SPREADSHIRT_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await wait(1000);
      }
    }
  }
  throw new Error(`Spreadshirt upload failed after 2 attempts: ${lastError?.message || lastError || 'unknown error'}`);
}

SpreadshirtAlphaFeature.prototype.prepare = async function prepareFollowingRecordedFlow(projectId) {
  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt gate check failed: ${gate.errors.join(' ')}`);
  const project = this.projects.read(projectId);
  const { page } = await this.sessions.ensureService('spreadshirt');
  await page.bringToFront();

  try {
    await performRecordedUploadFlow(this, page, project.spreadshirt.pngPath, projectId);

    activity(this, projectId, 'Product creation is ready. Filling Spreadshirt name, description and tags…');
    await this.fillMetadata(page, project.spreadshirt.metadata);

    const marketplaceEnabled = await enableSpreadshirtMarketplace(page);
    activity(this, projectId, marketplaceEnabled
      ? 'Publish on Spreadshirt marketplace enabled. Preparing final review…'
      : 'Spreadshirt metadata filled. Marketplace toggle was already enabled or not exposed separately.');

    const screenshotPath = path.join(this.projects.getProjectDir(projectId), 'spreadshirt-final-review.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    const current = this.projects.read(projectId);
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
    activity(this, projectId, 'Spreadshirt listing prepared. Waiting for final approval.');
    return {
      ok: true,
      project: updated,
      url: page.url(),
      reviewScreenshotPath: updated.spreadshirt?.reviewScreenshotPath || null,
      message: 'Spreadshirt upload, products, metadata and marketplace publishing settings are prepared for final review.'
    };
  } catch (error) {
    const current = this.projects.read(projectId);
    this.projects.update(projectId, {
      spreadshirt: {
        ...(current.spreadshirt || {}),
        status: 'recovery-needed',
        lastError: { message: error.message || String(error), at: new Date().toISOString() }
      }
    });
    activity(this, projectId, `Spreadshirt prepare failed: ${error.message || error}`, 'spreadshirt-error');
    throw error;
  }
};

async function clickPublishAndCompleteDialogs(page) {
  const clicked = await clickFirst([
    page.getByRole('button', { name: /save and publish/i }).first(),
    page.getByRole('button', { name: /^publish$/i }).first(),
    page.getByRole('button', { name: /publish design|publish to marketplace/i }).first()
  ]);
  if (!clicked) throw new Error('Spreadshirt “Save and publish” button was not found.');

  const started = Date.now();
  let sawWellDone = false;
  let sawWoohoo = false;
  while (Date.now() - started < 45000) {
    const text = await bodyText(page);
    if (UPLOAD_ERROR_PATTERN.test(text)) throw new Error('Spreadshirt showed an error after Save and publish.');
    if (/Well done!/i.test(text)) {
      sawWellDone = true;
      const continued = await clickFirst([
        page.getByRole('button', { name: /^continue$/i }).first(),
        page.getByText(/^continue$/i, { exact: true }).first()
      ]);
      if (continued) {
        await wait(500);
        continue;
      }
    }
    if (/Woohoo!?\s+You[’']ve made it/i.test(text)) {
      sawWoohoo = true;
      const close = page.getByRole('button', { name: /close/i }).first();
      if (await visible(close)) await close.click({ force: true }).catch(() => {});
      return { ok: true, sawWellDone, sawWoohoo, url: page.url() };
    }
    if (/submitted for review|pending|published|marketplace/i.test(text) && sawWellDone) {
      return { ok: true, sawWellDone, sawWoohoo, url: page.url() };
    }
    await wait(350);
  }
  return { ok: sawWellDone || sawWoohoo, sawWellDone, sawWoohoo, url: page.url() };
}

SpreadshirtAlphaFeature.prototype.publish = async function publishFollowingRecordedFlow(projectId) {
  const project = this.projects.read(projectId);
  if (!project.spreadshirt?.preparedAt) throw new Error('Prepare the Spreadshirt listing and complete the final review first.');
  const gate = await this.check(projectId);
  if (!gate.ok) throw new Error(`Spreadshirt publish gate failed: ${gate.errors.join(' ')}`);

  const { page } = await this.sessions.ensureService('spreadshirt');
  if (project.spreadshirt.editorUrl && page.url() !== project.spreadshirt.editorUrl) {
    await page.goto(project.spreadshirt.editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await page.bringToFront();
  await this.ensureSignedIn(page);
  activity(this, projectId, 'Final approval passed. Clicking Spreadshirt “Save and publish”…');

  const result = await clickPublishAndCompleteDialogs(page);
  if (!result.ok) {
    const current = this.projects.read(projectId);
    this.projects.update(projectId, {
      spreadshirt: {
        ...(current.spreadshirt || {}),
        status: 'publish-pending',
        publishPendingAt: new Date().toISOString(),
        lastError: { message: 'Save and publish was clicked, but ZeroPOD could not verify Spreadshirt completion.', at: new Date().toISOString() }
      }
    });
    throw new Error('Spreadshirt publish result could not be verified. Check the browser before retrying so ZeroPOD does not create a duplicate.');
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
  activity(this, projectId, 'Spreadshirt publish flow completed successfully.');
  return { ok: true, project: updated, publishedAt, url: page.url(), usage: this.usage() };
};

module.exports = {
  openCreateNewDialog,
  selectFileLikeVideo,
  waitForUploadResult,
  clickUploadedDesign,
  waitForDesignEditor,
  waitForProductsCreated,
  enableSpreadshirtMarketplace,
  performRecordedUploadFlow,
  clickPublishAndCompleteDialogs
};
