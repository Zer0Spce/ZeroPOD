const fs = require('fs');
const path = require('path');

class VectorizerController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  async start(projectId) {
    const project = this.projects.read(projectId);
    if (!project.generatedImagePath || !fs.existsSync(project.generatedImagePath)) {
      throw new Error('Approved generated image is missing.');
    }
    if (!project.metadata) throw new Error('Generate metadata before vectorization.');

    const { page } = await this.sessions.ensureService('vectorizer');
    await page.bringToFront();
    if (!page.url().startsWith('https://vectorizer.ai')) {
      await page.goto('https://vectorizer.ai/', { waitUntil: 'domcontentloaded' });
    }

    let fileInput = page.locator('input[type="file"]').first();
    if (!(await fileInput.count())) {
      const uploadButton = page.getByRole('button', { name: /upload|choose|select/i }).first();
      if (await uploadButton.count()) {
        await uploadButton.click();
        await page.waitForTimeout(500);
        fileInput = page.locator('input[type="file"]').first();
      }
    }
    if (!(await fileInput.count())) throw new Error('Could not find Vectorizer.ai upload control.');

    await fileInput.setInputFiles(project.generatedImagePath);
    this.projects.update(projectId, { status: 'vectorizing' });

    const projectDir = this.projects.getProjectDir(projectId);
    const downloadPromise = new Promise((resolve) => {
      const handler = async (download) => {
        try {
          const suggested = download.suggestedFilename() || 'vector.svg';
          const ext = path.extname(suggested).toLowerCase() || '.svg';
          const savePath = path.join(projectDir, `vector${ext}`);
          await download.saveAs(savePath);
          page.off('download', handler);
          const updated = this.projects.update(projectId, { status: 'vector-ready', vectorPath: savePath });
          resolve({ ok: true, path: savePath, project: updated });
        } catch (error) {
          resolve({ ok: false, error: error.message });
        }
      };
      page.on('download', handler);
    });

    const tryAutoDownload = async () => {
      const candidates = [
        page.getByRole('button', { name: /^svg$/i }).last(),
        page.getByRole('link', { name: /^svg$/i }).last(),
        page.getByRole('button', { name: /download.*svg|svg.*download/i }).last(),
        page.getByRole('link', { name: /download.*svg|svg.*download/i }).last(),
        page.getByRole('button', { name: /download/i }).last(),
        page.getByRole('link', { name: /download/i }).last()
      ];

      for (const candidate of candidates) {
        try {
          await candidate.waitFor({ state: 'visible', timeout: 180000 });
          await candidate.click();
          return;
        } catch {}
      }
      // If Vectorizer.ai changes its UI, the user can click its normal SVG download control.
      // The download listener above still captures and stores the file locally.
    };

    tryAutoDownload().catch(() => {});
    return {
      ok: true,
      projectId,
      status: 'vectorizing',
      message: 'Vectorizer.ai is processing the approved image. ZeroPOD will capture the SVG download when available.',
      completion: downloadPromise
    };
  }
}

module.exports = { VectorizerController };
