const { VectorizerController } = require('./vectorizerController');
const { RedbubbleController } = require('./redbubbleController');
const { retryStep, clickFirstVisible } = require('./automationUtils');

VectorizerController.prototype.uploadApprovedImage = async function uploadApprovedImageReadyDriven(page, approvedImagePath) {
  await retryStep('Upload image to Vectorizer.ai', async () => {
    let fileInput = page.locator('input[type="file"]').first();
    if (!(await fileInput.count().catch(() => 0))) {
      await clickFirstVisible([
        page.getByRole('button', { name: /upload|choose|select/i }).first(),
        page.getByText(/upload|choose image|select image/i, { exact: false }).first()
      ], { timeout: 6000 });
      fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
    }
    if (!(await fileInput.count().catch(() => 0))) throw new Error('Upload control not found.');
    await fileInput.setInputFiles(approvedImagePath);
  }, { attempts: 2, delayMs: 350 });
};

RedbubbleController.prototype.replaceAllImages = async function replaceAllImagesReadyDriven(page, imagePath) {
  const replaceButton = page.getByRole('button', { name: /replace all images/i }).first();
  if (!(await replaceButton.isVisible().catch(() => false))) {
    throw new Error('Redbubble Replace all images button was not found in the copied-work editor.');
  }

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await replaceButton.click({ force: true });
  const chooser = await chooserPromise;

  if (chooser) {
    await chooser.setFiles(imagePath);
  } else {
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.last().waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
    const count = await fileInputs.count().catch(() => 0);
    if (!count) throw new Error('Replace all images did not expose a file upload control.');
    await fileInputs.last().setInputFiles(imagePath);
  }

  await this.waitForArtworkUpload(page);
};

module.exports = {};
