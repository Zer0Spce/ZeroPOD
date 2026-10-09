const fs = require('fs');
const path = require('path');
const { retryStep, clickFirstVisible } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class VectorizerController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  async visibleEnabled(locator) {
    if (!(await locator.count().catch(() => 0))) return false;
    if (!(await locator.isVisible().catch(() => false))) return false;
    return locator.evaluate((element) => {
      const disabled = element.disabled === true
        || element.getAttribute('aria-disabled') === 'true'
        || element.hasAttribute('disabled');
      const style = window.getComputedStyle(element);
      return !disabled && style.visibility !== 'hidden' && style.display !== 'none';
    }).catch(() => false);
  }

  async findLargestDownloadControl(page, { minWidth = 0 } = {}) {
    const controls = page.locator('button, a, [role="button"]');
    const count = Math.min(await controls.count().catch(() => 0), 300);
    let best = null;

    for (let i = 0; i < count; i += 1) {
      const locator = controls.nth(i);
      if (!(await this.visibleEnabled(locator))) continue;

      const label = await locator.evaluate((element) => [
        element.innerText || element.textContent || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || ''
      ].join(' ')).catch(() => '');
      if (!/\bdownload\b/i.test(label)) continue;

      const box = await locator.boundingBox().catch(() => null);
      if (!box || box.width < minWidth || box.height < 20) continue;
      const score = box.width * box.height;
      if (!best || score > best.score) best = { locator, score, box, label: label.trim() };
    }

    return best?.locator || null;
  }

  async isDownloadOptionsPage(page) {
    const body = await page.locator('body').innerText().catch(() => '');
    return /File format/i.test(body)
      && /Optimize for/i.test(body)
      && /\bSVG\b/i.test(body)
      && /\bDownload\b/i.test(body);
  }

  async waitForDownloadOptions(page, timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.isDownloadOptionsPage(page)) return true;
      await wait(200);
    }
    return false;
  }

  async waitForResultReady(page, timeoutMs = 120000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.isDownloadOptionsPage(page)) return { stage: 'options', control: null };

      // The result page has both a tiny toolbar download icon and a large blue
      // DOWNLOAD button below the vector. Always choose the largest visible control.
      const control = await this.findLargestDownloadControl(page, { minWidth: 100 });
      if (control) return { stage: 'result', control };

      await wait(300);
    }
    throw new Error('Vectorizer.ai did not expose the finished result Download button before timeout.');
  }

  async clickControl(page, locator, description) {
    if (!locator) throw new Error(`${description} was not found.`);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await locator.click({ force: true, timeout: 5000 });
      return;
    } catch {}

    const box = await locator.boundingBox().catch(() => null);
    if (!box) throw new Error(`${description} could not be clicked.`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  async clickResultDownload(page, resultControl) {
    if (await this.isDownloadOptionsPage(page)) return true;

    await this.clickControl(page, resultControl, 'Vectorizer.ai result Download button');
    const reachedOptions = await this.waitForDownloadOptions(page, 20000);
    if (!reachedOptions) {
      throw new Error('Vectorizer.ai result Download button was clicked, but the SVG download/options page did not open.');
    }
    return true;
  }

  async selectSvgFormat(page) {
    if (!(await this.isDownloadOptionsPage(page))) {
      throw new Error('Vectorizer.ai SVG download/options page is not ready.');
    }

    // SVG is currently the default, but click it explicitly so the automation stays
    // deterministic if Vectorizer.ai remembers another format from a previous run.
    const svgText = page.getByText(/^SVG$/i, { exact: true });
    const count = await svgText.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const candidate = svgText.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const box = await candidate.boundingBox().catch(() => null);
      if (!box) continue;
      await candidate.click({ force: true }).catch(async () => {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      });
      await wait(250);
      break;
    }
  }

  snapshotFiles(projectDir) {
    const snapshot = new Map();
    try {
      for (const name of fs.readdirSync(projectDir)) {
        const file = path.join(projectDir, name);
        try {
          const stat = fs.statSync(file);
          if (stat.isFile()) snapshot.set(name, `${stat.size}:${stat.mtimeMs}`);
        } catch {}
      }
    } catch {}
    return snapshot;
  }

  validateAndPromoteSvg(filePath, projectDir) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size < 40) return null;
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(Math.min(stat.size, 8192));
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      fs.closeSync(fd);
      if (!/<svg[\s>]/i.test(buffer.toString('utf8'))) return null;

      const savePath = path.join(projectDir, 'vector.svg');
      if (path.resolve(filePath) !== path.resolve(savePath)) {
        try { if (fs.existsSync(savePath)) fs.unlinkSync(savePath); } catch {}
        fs.renameSync(filePath, savePath);
      }
      return savePath;
    } catch {
      return null;
    }
  }

  findNewSvgOnDisk(projectDir, baseline) {
    try {
      for (const name of fs.readdirSync(projectDir)) {
        if (/\.crdownload$|\.tmp$|\.part$/i.test(name)) continue;
        const file = path.join(projectDir, name);
        let stat;
        try { stat = fs.statSync(file); } catch { continue; }
        if (!stat.isFile()) continue;
        const signature = `${stat.size}:${stat.mtimeMs}`;
        if (baseline.get(name) === signature && name !== 'vector.svg') continue;
        const promoted = this.validateAndPromoteSvg(file, projectDir);
        if (promoted) return promoted;
      }
    } catch {}
    return null;
  }

  async configureDownloadDirectory(page, projectDir) {
    try {
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: projectDir,
          eventsEnabled: true
        });
        return cdp;
      } catch {
        await cdp.send('Page.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: projectDir
        }).catch(() => {});
        return cdp;
      }
    } catch {
      return null;
    }
  }

  async saveSvgDownload(download, projectDir) {
    const suggested = download.suggestedFilename() || `vectorizer-${Date.now()}.svg`;
    const tempPath = path.join(projectDir, `.vectorizer-${Date.now()}-${suggested.replace(/[^a-z0-9._-]/gi, '_')}`);
    await download.saveAs(tempPath);
    const promoted = this.validateAndPromoteSvg(tempPath, projectDir);
    if (!promoted) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
    return promoted;
  }

  async tryDirectSvgHref(page, projectDir) {
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({
        href: String(a.href || ''),
        text: String(a.innerText || a.textContent || ''),
        label: String(a.getAttribute('aria-label') || '')
      })))
      .catch(() => []);

    for (const item of hrefs) {
      if (!/\.svg(?:$|[?#])/i.test(item.href)
          && !/(?:format|file_format|output)[^=]*=svg/i.test(item.href)
          && !/\bsvg\b/i.test(`${item.text} ${item.label}`)) continue;
      try {
        const response = await page.context().request.get(item.href, { timeout: 15000 });
        if (!response.ok()) continue;
        const body = await response.body();
        if (!/<svg[\s>]/i.test(body.subarray(0, Math.min(body.length, 8192)).toString('utf8'))) continue;
        const savePath = path.join(projectDir, 'vector.svg');
        fs.writeFileSync(savePath, body);
        return savePath;
      } catch {}
    }
    return null;
  }

  async clickFinalSvgDownload(page, projectDir, downloads, baseline) {
    await this.selectSvgFormat(page);

    // On the options page the large blue Download button is the final action.
    // Pick the largest control so we never confuse it with browser/tool icons.
    const finalButton = await this.findLargestDownloadControl(page, { minWidth: 180 });
    if (!finalButton) throw new Error('Vectorizer.ai final SVG Download button was not found.');

    await this.clickControl(page, finalButton, 'Vectorizer.ai final SVG Download button');

    const started = Date.now();
    while (Date.now() - started < 30000) {
      while (downloads.length) {
        const download = downloads.shift();
        const saved = await this.saveSvgDownload(download, projectDir).catch(() => null);
        if (saved) return saved;
      }

      const diskSvg = this.findNewSvgOnDisk(projectDir, baseline);
      if (diskSvg) return diskSvg;
      await wait(250);
    }

    return this.tryDirectSvgHref(page, projectDir);
  }

  async captureSvgFromCurrentPage(page, projectDir, resultState = null) {
    fs.mkdirSync(projectDir, { recursive: true });
    try { fs.unlinkSync(path.join(projectDir, 'vector.svg')); } catch {}

    const baseline = this.snapshotFiles(projectDir);
    const downloads = [];
    const onDownload = (download) => downloads.push(download);
    page.on('download', onDownload);
    const cdp = await this.configureDownloadDirectory(page, projectDir);

    try {
      const state = resultState || await this.waitForResultReady(page, 120000);

      if (state.stage === 'result') {
        await this.clickResultDownload(page, state.control);
      }

      if (!(await this.isDownloadOptionsPage(page))) {
        throw new Error('Vectorizer.ai did not reach the SVG download/options page.');
      }

      return await this.clickFinalSvgDownload(page, projectDir, downloads, baseline);
    } finally {
      page.off('download', onDownload);
      if (cdp) await cdp.detach().catch(() => {});
    }
  }

  async uploadApprovedImage(page, approvedImagePath) {
    await retryStep('Upload image to Vectorizer.ai', async () => {
      let fileInput = page.locator('input[type="file"]').first();
      if (!(await fileInput.count())) {
        await clickFirstVisible([
          page.getByRole('button', { name: /upload|choose|select/i }).first(),
          page.getByText(/upload|choose image|select image/i, { exact: false }).first()
        ], { timeout: 6000 });
        await page.waitForTimeout(400);
        fileInput = page.locator('input[type="file"]').first();
      }
      if (!(await fileInput.count())) throw new Error('Upload control not found.');
      await fileInput.setInputFiles(approvedImagePath);
    }, { attempts: 2, delayMs: 900 });
  }

  async start(projectId) {
    const project = this.projects.read(projectId);
    const approvedImagePath = project.approvedImagePath || project.generatedImagePath;
    if (!approvedImagePath || !fs.existsSync(approvedImagePath)) {
      throw new Error('Approved generated image is missing.');
    }
    if (!project.metadata) throw new Error('Generate metadata before vectorization.');

    const { page } = await this.sessions.ensureService('vectorizer');
    await page.bringToFront();
    const projectDir = this.projects.getProjectDir(projectId);

    try {
      this.projects.update(projectId, { status: 'vectorizing', lastAutomationError: null });

      let savePath = null;

      // If the previous attempt reached either the result or options page, resume it
      // directly instead of throwing away completed Vectorizer.ai work.
      const currentUrl = page.url();
      if (project.status === 'vectorizer-recovery-needed' && /^https:\/\/vectorizer\.ai\/images\//i.test(currentUrl)) {
        const currentState = await this.waitForResultReady(page, 5000).catch(() => null);
        if (currentState) {
          savePath = await this.captureSvgFromCurrentPage(page, projectDir, currentState).catch(() => null);
        }
      }

      if (!savePath) {
        if (!page.url().startsWith('https://vectorizer.ai/') || /^https:\/\/vectorizer\.ai\/images\//i.test(page.url())) {
          await page.goto('https://vectorizer.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        await this.uploadApprovedImage(page, approvedImagePath);
        const resultState = await this.waitForResultReady(page, 120000);
        savePath = await this.captureSvgFromCurrentPage(page, projectDir, resultState);
      }

      if (!savePath || !fs.existsSync(savePath)) {
        throw new Error('Vectorizer.ai completed both download screens, but ZeroPOD could not capture the SVG file.');
      }

      const validated = this.validateAndPromoteSvg(savePath, projectDir);
      if (!validated) throw new Error('Vectorizer.ai download was captured, but it was not valid SVG data.');

      const updated = this.projects.update(projectId, {
        status: 'vector-ready',
        vectorPath: validated,
        lastAutomationError: null
      });

      return {
        ok: true,
        projectId,
        status: 'vector-ready',
        vectorPath: validated,
        project: updated,
        message: 'Vectorizer.ai finished and vector.svg was captured.'
      };
    } catch (error) {
      this.projects.update(projectId, {
        status: 'vectorizer-recovery-needed',
        lastAutomationError: {
          service: 'Vectorizer.ai',
          message: error.message,
          at: new Date().toISOString(),
          recovery: 'Keep the current Vectorizer.ai page open and retry Vectorize. ZeroPOD will resume the result page, press the first Download, keep SVG selected, press the second Download, and capture vector.svg.'
        }
      });
      throw error;
    }
  }
}

module.exports = { VectorizerController };
