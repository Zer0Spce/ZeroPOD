const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { retryStep, clickFirstVisible } = require('./automationUtils');

const SPREADSHIRT_ORIGIN = 'https://partner.spreadshirt.com';
const SPREADSHIRT_DESIGNS_URL = `${SPREADSHIRT_ORIGIN}/designs`;
const DAILY_UPLOAD_LIMIT = 10;
const ACCOUNT_UPLOAD_LIMIT = 50;
const MAX_DIMENSION = 4000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MIN_KEYWORDS = 3;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function shortTitle(value, max = 35) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  const sliced = text.slice(0, max + 1);
  const boundary = sliced.lastIndexOf(' ');
  return (boundary >= Math.floor(max * 0.55) ? sliced.slice(0, boundary) : text.slice(0, max)).trim();
}

function shortDescription(value, max = 200) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  const sliced = text.slice(0, max + 1);
  const boundary = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf(' '));
  return (boundary >= 100 ? sliced.slice(0, boundary + (sliced[boundary] === '.' ? 1 : 0)) : text.slice(0, max)).trim();
}

function validateListingMetadata(metadata = {}) {
  const errors = [];
  const warnings = [];
  const title = String(metadata.title || '').trim().replace(/\s+/g, ' ');
  const description = String(metadata.description || '').trim().replace(/\s+/g, ' ');
  const keywords = unique(metadata.keywords);
  if (!title) errors.push('Spreadshirt design name is required.');
  if (title.length > 35) errors.push('Spreadshirt design name must be 35 characters or fewer.');
  if (!description) errors.push('Spreadshirt description is required.');
  if (description.length > 200) errors.push('Spreadshirt description must be 200 characters or fewer.');
  if (keywords.length < MIN_KEYWORDS) errors.push(`At least ${MIN_KEYWORDS} Spreadshirt keywords are required.`);
  if (description.length && description.length < 130) warnings.push('Spreadshirt recommends a fuller description; 130–160 characters is a useful SEO target.');
  return { ok: errors.length === 0, errors, warnings, metadata: { title, description, keywords } };
}

class SpreadshirtAlphaFeature {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  getRoot() {
    const root = path.join(app.getPath('userData'), 'spreadshirt-alpha');
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  getSettingsPath() { return path.join(this.getRoot(), 'settings.json'); }
  getLedgerPath() { return path.join(this.getRoot(), 'publish-ledger.json'); }

  readSettings() {
    const defaults = {
      dailyLimit: DAILY_UPLOAD_LIMIT,
      accountLimit: ACCOUNT_UPLOAD_LIMIT,
      accountBaseline: 0,
      updatedAt: null
    };
    try {
      const file = this.getSettingsPath();
      if (!fs.existsSync(file)) return defaults;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        ...defaults,
        ...parsed,
        dailyLimit: DAILY_UPLOAD_LIMIT,
        accountLimit: ACCOUNT_UPLOAD_LIMIT,
        accountBaseline: Math.max(0, Number(parsed.accountBaseline) || 0)
      };
    } catch {
      return defaults;
    }
  }

  updateSettings(patch = {}) {
    const current = this.readSettings();
    const next = {
      ...current,
      accountBaseline: patch.accountBaseline === undefined
        ? current.accountBaseline
        : Math.max(0, Math.min(100000, Number(patch.accountBaseline) || 0)),
      dailyLimit: DAILY_UPLOAD_LIMIT,
      accountLimit: ACCOUNT_UPLOAD_LIMIT,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(this.getSettingsPath(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  readLedger() {
    try {
      const file = this.getLedgerPath();
      if (!fs.existsSync(file)) return [];
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  writeLedger(rows) {
    fs.writeFileSync(this.getLedgerPath(), JSON.stringify(rows.slice(-5000), null, 2), 'utf8');
  }

  usage() {
    const settings = this.readSettings();
    const ledger = this.readLedger();
    const todayKey = new Date().toDateString();
    const today = ledger.filter((entry) => new Date(entry.publishedAt).toDateString() === todayKey).length;
    const localPublished = ledger.length;
    const accountTotal = settings.accountBaseline + localPublished;
    return {
      dailyLimit: settings.dailyLimit,
      dailyUsed: today,
      dailyRemaining: Math.max(0, settings.dailyLimit - today),
      accountLimit: settings.accountLimit,
      accountBaseline: settings.accountBaseline,
      localPublished,
      accountTotal,
      accountRemaining: Math.max(0, settings.accountLimit - accountTotal),
      dailyBlocked: today >= settings.dailyLimit,
      accountBlocked: accountTotal >= settings.accountLimit
    };
  }

  recordPublish(projectId, publishedUrl = null) {
    const ledger = this.readLedger();
    if (!ledger.some((entry) => entry.projectId === projectId)) {
      ledger.push({ projectId, publishedAt: new Date().toISOString(), publishedUrl });
      this.writeLedger(ledger);
    }
    return this.usage();
  }

  async login() { return this.sessions.login('spreadshirt'); }

  async test() {
    const result = await this.sessions.test('spreadshirt');
    return { ...result, usage: this.usage() };
  }

  async open() {
    const { page } = await this.sessions.ensureService('spreadshirt');
    if (!page.url().startsWith(SPREADSHIRT_ORIGIN)) {
      await page.goto(SPREADSHIRT_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } else if (!/\/designs(?:[/?#]|$)/i.test(page.url())) {
      await page.goto(SPREADSHIRT_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    await page.bringToFront();
    return { ok: true, url: page.url() };
  }

  markProject(projectId, source = {}) {
    const project = this.projects.read(projectId);
    return this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        alpha: true,
        source: source.source || project.spreadshirt?.source || 'spreadshirt-alpha',
        researchKey: source.researchKey || project.spreadshirt?.researchKey || null,
        startedAt: project.spreadshirt?.startedAt || new Date().toISOString(),
        status: project.spreadshirt?.status || 'pipeline'
      }
    });
  }

  deriveMetadata(projectId) {
    const project = this.projects.read(projectId);
    if (!project.metadata) throw new Error('Generate POD WINNER metadata before creating Spreadshirt metadata.');
    const source = project.metadata;
    const derived = validateListingMetadata({
      title: shortTitle(source.title),
      description: shortDescription(source.description),
      keywords: unique([source.mainTag, ...(source.supportingTags || [])])
    });
    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        alpha: true,
        metadata: derived.metadata,
        metadataWarnings: derived.warnings,
        metadataUpdatedAt: new Date().toISOString(),
        status: project.spreadshirt?.status || 'listing-ready'
      }
    });
    return { ...derived, project: updated };
  }

  saveMetadata(projectId, metadata) {
    const validation = validateListingMetadata(metadata);
    if (!validation.ok) throw new Error(validation.errors.join(' '));
    const project = this.projects.read(projectId);
    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        alpha: true,
        metadata: validation.metadata,
        metadataWarnings: validation.warnings,
        metadataUpdatedAt: new Date().toISOString()
      }
    });
    return { ...validation, project: updated };
  }

  async renderSpreadshirtPng(projectId) {
    const project = this.projects.read(projectId);
    if (!project.vectorPath || !fs.existsSync(project.vectorPath)) throw new Error('Vector file is missing. Complete Vectorizer.ai first.');
    if (path.extname(project.vectorPath).toLowerCase() !== '.svg') throw new Error('Spreadshirt Alpha currently exports from the SVG created by Vectorizer.ai.');

    const svg = fs.readFileSync(project.vectorPath);
    const output = path.join(this.projects.getProjectDir(projectId), 'spreadshirt-4000.png');
    const attempts = [4000, 3600, 3200, 2800, 2400];
    let chosen = null;

    for (const dimension of attempts) {
      const rendered = await sharp(svg, { density: 600 })
        .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: false })
        .ensureAlpha()
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 12 })
        .withMetadata({ density: 200 })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
      const info = await sharp(rendered).metadata();
      if ((info.width || 0) > MAX_DIMENSION || (info.height || 0) > MAX_DIMENSION) continue;
      if (rendered.length <= MAX_FILE_BYTES) {
        chosen = { buffer: rendered, info, bytes: rendered.length };
        break;
      }
    }

    if (!chosen) throw new Error('Spreadshirt PNG could not be reduced below the 10 MB upload limit without becoming too small.');
    fs.writeFileSync(output, chosen.buffer);

    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        alpha: true,
        pngPath: output,
        export: {
          width: chosen.info.width,
          height: chosen.info.height,
          bytes: chosen.bytes,
          transparent: Boolean(chosen.info.hasAlpha),
          density: 200,
          maxDimension: MAX_DIMENSION,
          maxBytes: MAX_FILE_BYTES,
          sourceVector: project.vectorPath
        },
        exportedAt: new Date().toISOString(),
        status: 'export-ready'
      }
    });
    return { ok: true, path: output, export: updated.spreadshirt.export, project: updated };
  }

  async validateArtwork(project) {
    const errors = [];
    const warnings = [];
    const file = project.spreadshirt?.pngPath;
    if (!file || !fs.existsSync(file)) return { ok: false, errors: ['Spreadshirt PNG is missing.'], warnings, artwork: null };
    const stat = fs.statSync(file);
    const info = await sharp(file).metadata();
    if (info.format !== 'png') errors.push('Spreadshirt artwork must be PNG.');
    if (!info.hasAlpha) errors.push('Spreadshirt artwork must preserve transparency.');
    if ((info.width || 0) > MAX_DIMENSION || (info.height || 0) > MAX_DIMENSION) errors.push('Spreadshirt artwork must be no larger than 4000×4000 pixels.');
    if (stat.size > MAX_FILE_BYTES) errors.push('Spreadshirt artwork must be 10 MB or smaller.');
    if ((info.width || 0) < 1000 && (info.height || 0) < 1000) warnings.push('Artwork is relatively small; verify print quality before publishing.');
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      artwork: { width: info.width || null, height: info.height || null, format: info.format || null, hasAlpha: Boolean(info.hasAlpha), bytes: stat.size }
    };
  }

  async check(projectId) {
    const project = this.projects.read(projectId);
    const artwork = await this.validateArtwork(project);
    const metadata = validateListingMetadata(project.spreadshirt?.metadata || {});
    const usage = this.usage();
    const service = this.sessions.getStatuses().spreadshirt || {};
    const errors = [...artwork.errors, ...metadata.errors];
    if (service.authStatus !== 'verified') errors.push('Spreadshirt session is not verified. Open Login Browser and click Test Session.');
    if (usage.dailyBlocked) errors.push(`Spreadshirt daily safety limit reached (${usage.dailyUsed}/${usage.dailyLimit}).`);
    if (usage.accountBlocked) errors.push(`Spreadshirt account safety limit reached (${usage.accountTotal}/${usage.accountLimit}).`);
    return {
      ok: errors.length === 0,
      errors,
      warnings: [...artwork.warnings, ...metadata.warnings],
      artwork: artwork.artwork,
      metadata: metadata.metadata,
      usage,
      session: { authStatus: service.authStatus || 'not-configured', saved: Boolean(service.saved) },
      prepared: Boolean(project.spreadshirt?.preparedAt),
      published: Boolean(project.spreadshirt?.publishedAt)
    };
  }

  async ensureSignedIn(page) {
    const url = page.url();
    if (/\/(?:login|signin|register)(?:[/?#]|$)/i.test(url)) throw new Error('Spreadshirt login is required. Use Open Login Browser, sign in, then Test Session.');
    const body = await page.locator('body').innerText().catch(() => '');
    if (/sign in|log in|register/i.test(body) && !/designs|showroom|statistics|account/i.test(body)) {
      throw new Error('Spreadshirt login is required. Use Open Login Browser, sign in, then Test Session.');
    }
  }

  async openDesigns(page) {
    await page.goto(SPREADSHIRT_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.ensureSignedIn(page);
  }

  async uploadArtwork(page, file) {
    let input = page.locator('input[type="file"]').first();
    if (await input.count().catch(() => 0)) {
      await input.setInputFiles(file);
      return true;
    }

    const chooserPromise = page.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null);
    const clicked = await clickFirstVisible([
      page.getByRole('button', { name: /upload (?:a )?design|upload designs|add design|new design|upload/i }).first(),
      page.getByRole('link', { name: /upload (?:a )?design|upload designs|add design|new design|upload/i }).first(),
      page.getByText(/upload (?:a )?design|upload designs|add design/i, { exact: false }).first()
    ], { timeout: 6000 }).catch(() => false);
    if (!clicked) throw new Error('Spreadshirt Upload Design control was not found.');

    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(file);
      return true;
    }
    await page.waitForTimeout(500);
    input = page.locator('input[type="file"]').last();
    if (!(await input.count().catch(() => 0))) throw new Error('Spreadshirt upload did not expose a file input.');
    await input.setInputFiles(file);
    return true;
  }

  async findEditable(page, patterns, selectors = []) {
    for (const pattern of patterns) {
      const labelled = page.getByLabel(pattern).first();
      if (await labelled.count().catch(() => 0) && await labelled.isVisible().catch(() => false)) return labelled;
    }
    for (const selector of selectors) {
      const field = page.locator(selector).first();
      if (await field.count().catch(() => 0) && await field.isVisible().catch(() => false)) return field;
    }
    return null;
  }

  async fillMetadata(page, metadata) {
    for (let pass = 0; pass < 4; pass += 1) {
      const title = await this.findEditable(page, [/design name/i, /^name$/i, /title/i], [
        'input[name*="name" i]', 'input[name*="title" i]', 'input[placeholder*="name" i]', 'input[placeholder*="title" i]'
      ]);
      const description = await this.findEditable(page, [/description/i], [
        'textarea[name*="description" i]', 'textarea[placeholder*="description" i]'
      ]);
      const keywords = await this.findEditable(page, [/keywords?/i, /tags?/i], [
        'input[name*="keyword" i]', 'input[name*="tag" i]', 'textarea[name*="keyword" i]', 'textarea[name*="tag" i]',
        'input[placeholder*="keyword" i]', 'input[placeholder*="tag" i]'
      ]);

      if (title && description && keywords) {
        await title.fill(metadata.title);
        await description.fill(metadata.description);
        const combined = metadata.keywords.join(', ');
        await keywords.fill(combined).catch(async () => {
          await keywords.click({ force: true });
          for (const keyword of metadata.keywords) {
            await keywords.fill(keyword).catch(() => {});
            await keywords.press('Enter').catch(() => {});
            await wait(80);
          }
        });
        return true;
      }

      const advanced = await clickFirstVisible([
        page.getByRole('button', { name: /continue|next|edit details|add details|metadata/i }).first(),
        page.getByRole('link', { name: /continue|next|edit details|add details|metadata/i }).first()
      ], { timeout: 1800 }).catch(() => false);
      if (!advanced) await page.waitForTimeout(1000);
      else await page.waitForTimeout(800);
    }
    throw new Error('Spreadshirt metadata fields were not found after the artwork upload.');
  }

  async prepare(projectId) {
    const gate = await this.check(projectId);
    if (!gate.ok) throw new Error(`Spreadshirt gate check failed: ${gate.errors.join(' ')}`);
    const project = this.projects.read(projectId);
    const { page } = await this.sessions.ensureService('spreadshirt');
    await page.bringToFront();

    try {
      await retryStep('Open Spreadshirt Designs', () => this.openDesigns(page), { attempts: 2, delayMs: 700 });
      await retryStep('Upload Spreadshirt artwork', () => this.uploadArtwork(page, project.spreadshirt.pngPath), { attempts: 2, delayMs: 900 });
      await page.waitForTimeout(1500);
      await retryStep('Fill Spreadshirt metadata', () => this.fillMetadata(page, project.spreadshirt.metadata), { attempts: 2, delayMs: 900 });

      const updated = this.projects.update(projectId, {
        spreadshirt: {
          ...(project.spreadshirt || {}),
          status: 'review',
          preparedAt: new Date().toISOString(),
          editorUrl: page.url(),
          lastError: null
        }
      });
      return {
        ok: true,
        project: updated,
        url: page.url(),
        message: 'Spreadshirt artwork and metadata are prepared. Review product supercategories, target groups, automatic placement/contrast, and the listing in the browser before publishing.'
      };
    } catch (error) {
      this.projects.update(projectId, {
        spreadshirt: {
          ...(project.spreadshirt || {}),
          status: 'recovery-needed',
          lastError: { message: error.message || String(error), at: new Date().toISOString() }
        }
      });
      throw error;
    }
  }

  async detectPublishSuccess(page, beforeUrl) {
    for (let pass = 0; pass < 50; pass += 1) {
      const body = await page.locator('body').innerText().catch(() => '');
      const url = page.url();
      if (/published|submitted for review|design check|successfully (?:published|submitted)|your design is being checked/i.test(body)) {
        return { ok: true, url };
      }
      if (url !== beforeUrl && /\/designs(?:[/?#]|$)/i.test(url) && !/edit|new|create/i.test(url)) return { ok: true, url };
      await page.waitForTimeout(500);
    }
    return { ok: false, url: page.url() };
  }

  async publish(projectId) {
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
    const beforeUrl = page.url();

    const clicked = await clickFirstVisible([
      page.getByRole('button', { name: /^publish$/i }).first(),
      page.getByRole('button', { name: /publish design|publish to marketplace|save.*publish/i }).first(),
      page.getByRole('button', { name: /submit.*review/i }).first()
    ], { timeout: 6000 }).catch(() => false);
    if (!clicked) throw new Error('Spreadshirt Publish button was not found. Review the listing in the browser and retry.');

    const success = await this.detectPublishSuccess(page, beforeUrl);
    if (!success.ok) {
      this.projects.update(projectId, {
        spreadshirt: {
          ...(project.spreadshirt || {}),
          status: 'publish-pending',
          publishPendingAt: new Date().toISOString(),
          lastError: { message: 'Publish was clicked, but ZeroPOD could not verify Spreadshirt success.', at: new Date().toISOString() }
        }
      });
      throw new Error('Spreadshirt publish result could not be verified. Check the browser before retrying so ZeroPOD does not create a duplicate.');
    }

    const publishedAt = new Date().toISOString();
    this.recordPublish(projectId, success.url);
    const updated = this.projects.update(projectId, {
      spreadshirt: {
        ...(project.spreadshirt || {}),
        status: 'published',
        publishedAt,
        publishedUrl: success.url,
        lastError: null
      }
    });
    return { ok: true, project: updated, publishedAt, url: success.url, usage: this.usage() };
  }
}

module.exports = {
  SpreadshirtAlphaFeature,
  SPREADSHIRT_ORIGIN,
  SPREADSHIRT_DESIGNS_URL,
  DAILY_UPLOAD_LIMIT,
  ACCOUNT_UPLOAD_LIMIT,
  MAX_DIMENSION,
  MAX_FILE_BYTES,
  validateListingMetadata,
  shortTitle,
  shortDescription
};
