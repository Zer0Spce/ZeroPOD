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

  async waitForResultReady(page, timeoutMs = 120000) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const downloadCandidates = [
        page.getByRole('button', { name: /^download$/i }).last(),
        page.getByRole('link', { name: /^download$/i }).last(),
        page.locator('button').filter({ hasText: /^\s*download\s*$/i }).last(),
        page.locator('a').filter({ hasText: /^\s*download\s*$/i }).last(),
        page.locator('[aria-label*="download" i]').last(),
        page.locator('[title*="download" i]').last()
      ];

      for (const candidate of downloadCandidates) {
        if (await this.visibleEnabled(candidate)) return candidate;
      }

      // Current Vectorizer.ai result pages expose the finished preview independently
      // of older semantic wrappers. If the result preview is visible, keep polling a
      // little longer for the download control instead of treating the upload as stuck.
      const resultVisible = await page.locator('img[alt*="Vectorizer" i], img[alt*="Result" i], canvas').last().isVisible().catch(() => false);
      if (resultVisible) await wait(200);
      else await wait(350);
    }

    throw new Error('Vectorizer.ai did not expose a finished result/download control before timeout.');
  }

  async saveSvgDownload(download, projectDir) {
    const suggested = download.suggestedFilename() || 'vector.svg';
    const tempPath = path.join(projectDir, `.vectorizer-${Date.now()}-${suggested.replace(/[^a-z0-9._-]/gi, '_')}`);
    await download.saveAs(tempPath);

    let isSvg = path.extname(suggested).toLowerCase() === '.svg';
    try {
      const sample = fs.readFileSync(tempPath, { encoding: 'utf8' }).slice(0, 4096);
      if (/<svg[\s>]/i.test(sample)) isSvg = true;
    } catch {}

    if (!isSvg) {
      try { fs.unlinkSync(tempPath); } catch {}
      return null;
    }

    const savePath = path.join(projectDir, 'vector.svg');
    try { if (fs.existsSync(savePath)) fs.unlinkSync(savePath); } catch {}
    fs.renameSync(tempPath, savePath);
    return savePath;
  }

  async tryDirectSvgHref(page, projectDir) {
    const href = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const match = links.find((a) => {
        const hrefValue = String(a.href || '');
        const text = String(a.innerText || a.textContent || '');
        const label = String(a.getAttribute('aria-label') || '');
        return /\.svg(?:$|[?#])/i.test(hrefValue)
          || /(?:format|file_format|output)[^=]*=svg/i.test(hrefValue)
          || /\bsvg\b/i.test(`${text} ${label}`);
      });
      return match?.href || null;
    }).catch(() => null);

    if (!href) return null;

    try {
      const response = await page.context().request.get(href, { timeout: 15000 });
      if (!response.ok()) return null;
      const body = await response.body();
      const textStart = body.subarray(0, Math.min(body.length, 4096)).toString('utf8');
      if (!/<svg[\s>]/i.test(textStart)) return null;
      const savePath = path.join(projectDir, 'vector.svg');
      fs.writeFileSync(savePath, body);
      return savePath;
    } catch {
      return null;
    }
  }

  async captureSvgFromResult(page, resultDownloadButton, projectDir) {
    const downloads = [];
    const onDownload = (download) => downloads.push(download);
    page.on('download', onDownload);

    const saveCapturedSvg = async () => {
      while (downloads.length) {
        const download = downloads.shift();
        const saved = await this.saveSvgDownload(download, projectDir).catch(() => null);
        if (saved) return saved;
      }
      return null;
    };

    try {
      // Step 1: click the large finished-result DOWNLOAD control shown by the web app.
      await resultDownloadButton.scrollIntoViewIfNeeded().catch(() => {});
      await resultDownloadButton.click({ force: true }).catch(async () => {
        const box = await resultDownloadButton.boundingBox();
        if (!box) throw new Error('Vectorizer.ai result Download button could not be clicked.');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      });
      await wait(700);

      let savePath = await saveCapturedSvg();
      if (savePath) return savePath;

      // Step 2: Vectorizer.ai may open a format/download panel. Prefer SVG explicitly.
      const svgCandidates = [
        page.getByRole('button', { name: /^svg$/i }).last(),
        page.getByRole('link', { name: /^svg$/i }).last(),
        page.getByText(/^svg$/i, { exact: true }).last(),
        page.locator('label').filter({ hasText: /^\s*svg\s*$/i }).last(),
        page.locator('[data-value="svg"], [value="svg"]').last()
      ];

      for (const svgChoice of svgCandidates) {
        if (!(await svgChoice.isVisible().catch(() => false))) continue;
        await svgChoice.click({ force: true }).catch(() => {});
        await wait(450);
        savePath = await saveCapturedSvg();
        if (savePath) return savePath;
        break;
      }

      // Step 3: after selecting SVG, click the Download/Save/Export action inside
      // the active dialog/panel. Search the dialog first, then the page globally.
      const dialog = page.locator('[role="dialog"], [aria-modal="true"]').last();
      const dialogVisible = await dialog.isVisible().catch(() => false);
      const actionScope = dialogVisible ? dialog : page.locator('body');
      const actionCandidates = [
        actionScope.getByRole('button', { name: /^download$/i }).last(),
        actionScope.getByRole('link', { name: /^download$/i }).last(),
        actionScope.getByRole('button', { name: /download.*svg|svg.*download/i }).last(),
        actionScope.getByRole('button', { name: /save|export/i }).last(),
        actionScope.locator('[aria-label*="download" i], [title*="download" i]').last()
      ];

      for (const action of actionCandidates) {
        if (!(await this.visibleEnabled(action))) continue;
        await action.click({ force: true }).catch(() => {});
        await wait(700);
        savePath = await saveCapturedSvg();
        if (savePath) return savePath;
      }

      // Give any browser download started by the last click a short completion window.
      const settleStarted = Date.now();
      while (Date.now() - settleStarted < 8000) {
        savePath = await saveCapturedSvg();
        if (savePath) return savePath;
        await wait(250);
      }

      // Final fallback: if the result page exposes a signed/direct SVG href, fetch it
      // with the same authenticated browser context instead of relying on filenames.
      return this.tryDirectSvgHref(page, projectDir);
    } finally {
      page.off('download', onDownload);
    }
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
    if (!page.url().startsWith('https://vectorizer.ai')) {
      await page.goto('https://vectorizer.ai/', { waitUntil: 'domcontentloaded' });
    }

    try {
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

      this.projects.update(projectId, {
        status: 'vectorizing',
        lastAutomationError: null
      });

      // Do not hunt for an SVG/download control while Vectorizer.ai is still
      // processing. Wait until the finished-result DOWNLOAD control is genuinely ready.
      const resultDownloadButton = await this.waitForResultReady(page, 120000);
      const projectDir = this.projects.getProjectDir(projectId);
      const savePath = await this.captureSvgFromResult(page, resultDownloadButton, projectDir);

      if (!savePath || !fs.existsSync(savePath)) {
        throw new Error('Vectorizer.ai finished the preview, but ZeroPOD could not capture the SVG download.');
      }

      const svgText = fs.readFileSync(savePath, 'utf8');
      if (!/<svg[\s>]/i.test(svgText.slice(0, 8192))) {
        throw new Error('Vectorizer.ai download was captured, but it was not a valid SVG file.');
      }

      const updated = this.projects.update(projectId, {
        status: 'vector-ready',
        vectorPath: savePath,
        lastAutomationError: null
      });

      return {
        ok: true,
        projectId,
        status: 'vector-ready',
        vectorPath: savePath,
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
          recovery: 'Keep the current Vectorizer.ai result open and retry Vectorize. ZeroPOD will wait for the finished result, choose SVG, capture the download, and verify the SVG file.'
        }
      });
      throw error;
    }
  }
}

module.exports = { VectorizerController };
