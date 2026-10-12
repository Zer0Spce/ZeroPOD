const fs = require('fs');
const sharp = require('sharp');
const { SpreadshirtAlphaFeature } = require('./spreadshirtAlphaFeature');
const { locateMetadataFields } = require('./spreadshirtJourneyReliabilityPatch');
const {
  MAX_SPREADSHIRT_DIMENSION,
  MAX_SPREADSHIRT_BYTES
} = require('./spreadshirtRegularExportPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RIGHTS_PATTERN = /owner of the copyright|copyright or license rights|license rights|quality and community standards/i;
const UPLOAD_ERROR_PATTERN = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error occured|Unfortunately, an error occurred/i;
const HUMAN_CHECK_PATTERN = /captcha|verify you are human|are you human|cloudflare/i;

async function visible(locator) {
  try {
    return Boolean(await locator.count()) && await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function ensureRightsConfirmation(page) {
  for (const frame of page.frames()) {
    const named = frame.getByRole('checkbox', { name: RIGHTS_PATTERN }).first();
    if (await named.count().catch(() => 0)) {
      const checked = await named.isChecked().catch(() => false);
      if (!checked) await named.check({ force: true }).catch(() => {});
      if (await named.isChecked().catch(() => false)) return true;
    }

    const checkboxes = frame.locator('input[type="checkbox"]');
    const count = await checkboxes.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const checkbox = checkboxes.nth(index);
      const context = await checkbox.evaluate((el) => {
        const label = el.closest('label');
        const parent = el.parentElement;
        return String(label?.innerText || parent?.innerText || el.getAttribute('aria-label') || '').trim();
      }).catch(() => '');
      if (!RIGHTS_PATTERN.test(context)) continue;
      const checked = await checkbox.isChecked().catch(() => false);
      if (!checked) await checkbox.check({ force: true }).catch(async () => {
        const id = await checkbox.getAttribute('id').catch(() => null);
        if (id) await frame.locator(`label[for="${String(id).replace(/"/g, '\\"')}"]`).first().click({ force: true }).catch(() => {});
      });
      if (await checkbox.isChecked().catch(() => false)) return true;
    }

    const label = frame.locator('label').filter({ hasText: RIGHTS_PATTERN }).first();
    if (await visible(label)) {
      await label.click({ force: true }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function setArtworkFile(page, file) {
  const selectors = [
    '#listFileInput',
    'input#listFileInput',
    '#hiddenFileInput',
    'input#hiddenFileInput',
    'input[type="file"]'
  ];

  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const input = frame.locator(selector).first();
      if (!(await input.count().catch(() => 0))) continue;
      await input.setInputFiles(file);
      return { selector };
    }
  }

  for (const frame of page.frames()) {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    const browse = frame.getByRole('button', { name: /browse|upload design|upload designs|add design/i }).first();
    if (!(await visible(browse))) continue;
    await browse.click({ force: true });
    const chooser = await chooserPromise;
    if (!chooser) continue;
    await chooser.setFiles(file);
    return { selector: 'filechooser' };
  }

  throw new Error('Spreadshirt upload file input was not found.');
}

async function uploadPageState(page) {
  const body = await page.locator('body').innerText().catch(() => '');
  const fileInputs = await page.locator('input[type="file"]').count().catch(() => 0);
  return { body, fileInputs, url: page.url() };
}

async function waitForUploadProgress(page, beforeState, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const fields = await locateMetadataFields(page).catch(() => null);
    if (fields) return { ok: true, reason: 'metadata-fields' };

    const state = await uploadPageState(page);
    if (HUMAN_CHECK_PATTERN.test(state.body)) {
      throw new Error('Spreadshirt is showing a human-verification challenge. Complete it manually, then retry.');
    }
    if (UPLOAD_ERROR_PATTERN.test(state.body)) {
      throw new Error('Spreadshirt rejected the artwork on the upload page with “Ooops! Snap. It didn’t work.”');
    }

    if (state.url !== beforeState.url) return { ok: true, reason: 'url-changed' };
    if (/supercategor|target group|design name|design details|listing details|description|keywords?|select products?|product groups?/i.test(state.body) &&
        !/Upload your designs here and start creating products/i.test(state.body)) {
      return { ok: true, reason: 'publishing-journey' };
    }
    if (/upload(?:ed)? successfully|design uploaded|processing design|checking design|optimizing design/i.test(state.body)) {
      return { ok: true, reason: 'upload-confirmed' };
    }
    if (beforeState.fileInputs > 0 && state.fileInputs === 0 && !/Upload your designs here and start creating products/i.test(state.body)) {
      return { ok: true, reason: 'upload-screen-left' };
    }

    await wait(500);
  }
  throw new Error('Spreadshirt did not confirm that the artwork upload started.');
}

async function inspectArtwork(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Spreadshirt upload artwork file is missing.');
  const stat = fs.statSync(file);
  const info = await sharp(file).metadata();
  if (info.format !== 'png') throw new Error('Spreadshirt upload artwork must be PNG.');
  if (!info.hasAlpha) throw new Error('Spreadshirt upload artwork must preserve transparency.');
  if ((info.width || 0) > MAX_SPREADSHIRT_DIMENSION || (info.height || 0) > MAX_SPREADSHIRT_DIMENSION) {
    throw new Error(`Spreadshirt upload artwork is ${info.width || '?'}×${info.height || '?'}; maximum is ${MAX_SPREADSHIRT_DIMENSION}×${MAX_SPREADSHIRT_DIMENSION}.`);
  }
  if (stat.size > MAX_SPREADSHIRT_BYTES) {
    throw new Error(`Spreadshirt upload artwork is ${(stat.size / 1024 / 1024).toFixed(2)} MB; maximum is 10 MB.`);
  }
  return { width: info.width || null, height: info.height || null, bytes: stat.size };
}

SpreadshirtAlphaFeature.prototype.uploadArtwork = async function uploadArtworkReliable(page, file) {
  const artwork = await inspectArtwork(file);
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (attempt > 1) {
        await this.openDesigns(page);
        await wait(900);
      }

      const current = await uploadPageState(page);
      if (UPLOAD_ERROR_PATTERN.test(current.body)) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await this.ensureSignedIn(page);
        await wait(900);
      }

      await ensureRightsConfirmation(page);
      const beforeState = await uploadPageState(page);
      await setArtworkFile(page, file);
      await waitForUploadProgress(page, beforeState, 30000);
      return true;
    } catch (error) {
      lastError = error;
      if (HUMAN_CHECK_PATTERN.test(String(error?.message || error))) throw error;
      if (attempt < 3) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await this.ensureSignedIn(page).catch(() => {});
        await wait(1200);
      }
    }
  }

  throw new Error(
    `Spreadshirt artwork upload failed after 3 attempts: ${lastError?.message || lastError || 'unknown upload error'} ` +
    `(upload copy ${artwork.width || '?'}×${artwork.height || '?'}, ${(artwork.bytes / 1024 / 1024).toFixed(2)} MB).`
  );
};

module.exports = {
  ensureRightsConfirmation,
  waitForUploadProgress,
  inspectArtwork
};
