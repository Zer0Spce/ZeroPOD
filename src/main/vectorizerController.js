const fs = require('fs');
const path = require('path');
const { retryStep, clickFirstVisible } = require('./automationUtils');

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
        await fileInput.setInputFiles(project.generatedImagePath);
      }, { attempts: 2, delayMs: 900 });

      this.projects.update(projectId, { status: 'vectorizing', lastAutomationError: null });

      const projectDir = this.projects.getProjectDir(projectId);
      const handler = async (download) => {
        try {
          const suggested = download.suggestedFilename() || 'vector.svg';
          const ext = path.extname(suggested).toLowerCase() || '.svg';
          const savePath = path.join(projectDir, `vector${ext}`);
          await download.saveAs(savePath);
          page.off('download', handler);
          this.projects.update(projectId, {
            status: 'vector-ready',
            vectorPath: savePath,
            lastAutomationError: null
          });
        } catch (error) {
          this.projects.update(projectId, {
            status: 'vectorizer-recovery-needed',
            lastAutomationError: {
              service: 'Vectorizer.ai',
              message: error.message,
              at: new Date().toISOString(),
              recovery: 'Use the normal SVG download button in Vectorizer.ai, then retry the Vectorize step if the file was not captured.'
            }
          });
        }
      };
      page.on('download', handler);

      const tryAutoDownload = async () => {
        const clicked = await clickFirstVisible([
          page.getByRole('button', { name: /^svg$/i }).last(),
          page.getByRole('link', { name: /^svg$/i }).last(),
          page.getByRole('button', { name: /download.*svg|svg.*download/i }).last(),
          page.getByRole('link', { name: /download.*svg|svg.*download/i }).last(),
          page.getByRole('button', { name: /download/i }).last(),
          page.getByRole('link', { name: /download/i }).last()
        ], { timeout: 30000 });
        if (!clicked) {
          this.projects.update(projectId, {
            status: 'vectorizer-manual-download',
            lastAutomationError: {
              service: 'Vectorizer.ai',
              message: 'Automatic SVG download control was not found.',
              at: new Date().toISOString(),
              recovery: 'Click Vectorizer.ai’s normal SVG download control. ZeroPOD is still listening for the download and will capture it.'
            }
          });
        }
      };

      tryAutoDownload().catch(() => {});
      return {
        ok: true,
        projectId,
        status: 'vectorizing',
        message: 'Vectorizer.ai is processing the approved image. ZeroPOD will capture the SVG download; if needed, click the normal SVG download button manually.'
      };
    } catch (error) {
      this.projects.update(projectId, {
        status: 'vectorizer-recovery-needed',
        lastAutomationError: {
          service: 'Vectorizer.ai',
          message: error.message,
          at: new Date().toISOString(),
          recovery: 'Open Vectorizer.ai from Connections, verify login and upload access, then retry Vectorize.'
        }
      });
      throw error;
    }
  }
}

module.exports = { VectorizerController };
