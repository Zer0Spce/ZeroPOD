const { feature } = require('./spreadshirtAlphaIpc');
const { waitForDesignEditor, waitForProductsCreated } = require('./spreadshirtVideoFlowPatch');

function isMarketplaceDesignsIndexUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.hostname === 'partner.spreadshirt.com'
      && /^\/mp\/designs\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isMarketplaceDesignEditorUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.hostname === 'partner.spreadshirt.com'
      && /^\/mp\/designs\/[^/?#]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function looksLikeDesignEditor(page) {
  const url = page.url();
  if (!isMarketplaceDesignEditorUrl(url)) return false;
  const text = await page.locator('body').innerText().catch(() => '');
  return /Design products/i.test(text)
    && /Metadata/i.test(text)
    && /Products/i.test(text);
}

const previousOpenDesigns = feature.openDesigns.bind(feature);
feature.openDesigns = async function openDesignsOrResumeEditor(page) {
  if (await looksLikeDesignEditor(page)) {
    await this.ensureSignedIn(page);
    return { editorAlreadyOpen: true, url: page.url() };
  }
  return previousOpenDesigns(page);
};

const previousPrepare = feature.prepare.bind(feature);
feature.prepare = async function prepareWithEditorResume(projectId) {
  const { page } = await this.sessions.ensureService('spreadshirt');
  if (await looksLikeDesignEditor(page)) {
    try {
      this.projects.addActivity(projectId, {
        type: 'spreadshirt',
        label: 'Spreadshirt design editor is already open. Continuing from the existing uploaded design instead of returning to Designs…'
      });
      await this.ensureSignedIn(page);
      await waitForDesignEditor(page, 15000);
      await waitForProductsCreated(page, 45000);

      const project = this.projects.read(projectId);
      await this.fillMetadata(page, project.spreadshirt.metadata);

      const current = this.projects.read(projectId);
      const updated = this.projects.update(projectId, {
        spreadshirt: {
          ...(current.spreadshirt || {}),
          status: 'review',
          preparedAt: new Date().toISOString(),
          editorUrl: page.url(),
          lastError: null
        }
      });
      this.projects.addActivity(projectId, {
        type: 'spreadshirt',
        label: 'Existing Spreadshirt design editor recovered. Listing is ready for final review.'
      });
      return {
        ok: true,
        project: updated,
        url: page.url(),
        reviewScreenshotPath: updated.spreadshirt?.reviewScreenshotPath || null,
        message: 'Spreadshirt existing design editor recovered for final review.'
      };
    } catch (error) {
      const message = String(error?.message || error || '');
      if (!/Design products|Metadata|Products|Full front|Product settings|Publish on Spreadshirt/i.test(message)) {
        throw error;
      }
      // Fall through to the proven prepare path if the editor is only partially loaded.
    }
  }
  return previousPrepare(projectId);
};

module.exports = {
  isMarketplaceDesignsIndexUrl,
  isMarketplaceDesignEditorUrl,
  looksLikeDesignEditor
};
