const path = require('path');
const { ChatGPTController } = require('./chatgptController');
const { clickFirstVisible } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function composerAttachmentState(page, referencePath) {
  const fileName = path.basename(referencePath || '');
  return page.evaluate((expectedFileName) => {
    const composer = document.querySelector('#prompt-textarea, [data-testid="composer-text-input"], textarea[placeholder*="Message" i], textarea, [contenteditable="true"][data-placeholder], [contenteditable="true"]');
    const root = composer?.closest('form') || composer?.parentElement?.parentElement?.parentElement || document.body;
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const previews = [...root.querySelectorAll('img')].filter((image) => {
      if (!visible(image)) return false;
      const rect = image.getBoundingClientRect();
      return rect.width >= 32 && rect.height >= 32;
    });
    const removeControls = [...root.querySelectorAll('button[aria-label*="remove" i], button[title*="remove" i], [data-testid*="remove" i]')].filter(visible);
    const attachmentNodes = [...root.querySelectorAll('[data-testid*="attachment" i], [data-testid*="upload" i], [data-testid*="file" i]')].filter(visible);
    const text = String(root.innerText || '');

    const sendButton = root.querySelector('button[data-testid="send-button"], button[data-testid*="send" i], button[aria-label*="send" i]')
      || document.querySelector('button[data-testid="send-button"], button[data-testid*="send" i], button[aria-label*="send" i]');
    const sendEnabled = Boolean(sendButton && visible(sendButton) && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true');

    const busy = Boolean(root.querySelector('[role="progressbar"], [aria-busy="true"], [data-state="loading"], [data-testid*="uploading" i], [data-testid*="progress" i]'))
      || /uploading|processing (?:image|file)|attaching/i.test(text);
    const failed = /upload failed|failed to upload|couldn['’]t upload|unsupported file|file too large/i.test(text);
    const named = Boolean(expectedFileName && text.toLowerCase().includes(expectedFileName.toLowerCase()));

    return {
      previewCount: previews.length,
      removeCount: removeControls.length,
      attachmentCount: attachmentNodes.length,
      sendEnabled,
      busy,
      failed,
      named
    };
  }, fileName).catch(() => ({ previewCount: 0, removeCount: 0, attachmentCount: 0, sendEnabled: false, busy: false, failed: false, named: false }));
}

ChatGPTController.prototype.attachReference = async function attachReference(page, referencePath) {
  await this.assertNoHumanGate(page);
  const before = await composerAttachmentState(page, referencePath);

  let input = page.locator('input[type="file"]').first();
  if (!(await input.count())) {
    await clickFirstVisible([
      page.locator('button[data-testid*="composer" i][aria-label*="add" i]').first(),
      page.locator('button[data-testid*="attach" i]').first(),
      page.getByRole('button', { name: /add files|attach|upload|photos|files|add/i }).first(),
      page.locator('button[aria-label*="add files" i]').first(),
      page.locator('button[aria-label*="attach" i]').first(),
      page.locator('button[aria-label*="upload" i]').first()
    ], { timeout: 5000 });
    await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 5000 });
    input = page.locator('input[type="file"]').first();
  }

  if (!(await input.count())) throw new Error('Could not find ChatGPT image upload input.');
  await input.setInputFiles(referencePath);

  // ChatGPT commonly clears the <input type=file> immediately after accepting it,
  // so input.files is NOT a valid upload-complete signal. Wait for the composer
  // attachment UI instead, and do not paste the prompt until that attachment is ready.
  const started = Date.now();
  let stableReadySince = 0;
  while (Date.now() - started < 60000) {
    await this.assertNoHumanGate(page);
    const state = await composerAttachmentState(page, referencePath);
    if (state.failed) throw new Error('ChatGPT reported that the reference image upload failed.');

    const attachmentVisible = state.previewCount > before.previewCount
      || state.removeCount > before.removeCount
      || state.attachmentCount > before.attachmentCount
      || state.named;

    if (attachmentVisible && !state.busy) {
      if (!stableReadySince) stableReadySince = Date.now();
      const stableFor = Date.now() - stableReadySince;
      // An enabled Send button is ChatGPT's strongest signal that the attachment is
      // usable. If its markup changes, a stable attachment preview is the fallback.
      if ((state.sendEnabled && stableFor >= 350) || stableFor >= 1800) return true;
    } else {
      stableReadySince = 0;
    }

    await wait(200);
  }

  throw new Error('Timed out waiting for ChatGPT to finish attaching the reference image. The prompt was not pasted because the image never reached a ready state.');
};
