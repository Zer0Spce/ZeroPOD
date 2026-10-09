const fs = require('fs');
const { MetadataController } = require('./metadataController');
const { automationError } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function composerText(controller, page) {
  const composer = controller.chat.composerLocator(page);
  if (!(await composer.count().catch(() => 0))) return '';
  return composer.evaluate((element) => {
    if ('value' in element) return String(element.value || '');
    return String(element.innerText || element.textContent || '');
  }).catch(() => '');
}

async function metadataAttachmentReady(controller, page, timeoutMs = 20000) {
  const started = Date.now();
  let sawAttachment = false;

  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => {
      const composer = document.querySelector('#prompt-textarea, [data-testid="composer-text-input"], textarea[placeholder*="Message" i], textarea, [contenteditable="true"]');
      if (!composer) return { composer: false, attachment: false, busy: false, sendEnabled: false };

      const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
      };

      const c = composer.getBoundingClientRect();
      const nearComposer = (element) => {
        if (!visible(element)) return false;
        const r = element.getBoundingClientRect();
        return r.bottom >= c.top - 430 && r.top <= c.bottom + 200 && r.right >= c.left - 240 && r.left <= c.right + 240;
      };

      const attachment = [...document.querySelectorAll('img, [data-testid*="attachment" i], [data-testid*="upload" i], [data-testid*="file" i], button[aria-label*="remove" i], button[title*="remove" i]')]
        .some((element) => {
          if (!nearComposer(element)) return false;
          if (element.tagName === 'IMG') {
            const r = element.getBoundingClientRect();
            return r.width >= 28 && r.height >= 28;
          }
          return true;
        });

      const busy = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-state="loading"], [data-testid*="uploading" i], [data-testid*="progress" i]')]
        .some(nearComposer);

      const sendCandidates = [...document.querySelectorAll('button')].filter((button) => {
        if (!nearComposer(button)) return false;
        const identity = `${button.id || ''} ${button.getAttribute('data-testid') || ''} ${button.getAttribute('aria-label') || ''}`;
        return /composer-submit-button|send/i.test(identity);
      });
      const send = sendCandidates.find((button) => !button.disabled && button.getAttribute('aria-disabled') !== 'true');

      return { composer: true, attachment, busy, sendEnabled: Boolean(send) };
    }).catch(() => ({ composer: false, attachment: false, busy: false, sendEnabled: false }));

    if (state.attachment) sawAttachment = true;
    if (state.composer && sawAttachment && !state.busy && state.sendEnabled) return true;
    await wait(120);
  }

  throw new Error(sawAttachment
    ? 'The approved image is visible in ChatGPT, but the metadata composer did not become send-ready.'
    : 'ChatGPT accepted the approved image file, but ZeroPOD never saw the attachment become ready for metadata.');
}

async function fillStableMetadataPrompt(controller, page, prompt, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  const marker = prompt.split('\n')[0];
  const minimumLength = Math.min(prompt.length * 0.75, 240);

  while (Date.now() - started < timeoutMs) {
    try {
      await controller.chat.fillPrompt(page, prompt);
      await wait(180);
      let value = await composerText(controller, page);
      if (!value.includes(marker) || value.length < minimumLength) throw new Error('metadata prompt did not remain in the composer');

      await wait(320);
      value = await composerText(controller, page);
      if (value.includes(marker) && value.length >= minimumLength) {
        return controller.chat.composerLocator(page);
      }
      throw new Error('metadata prompt disappeared after ChatGPT refreshed the composer');
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }

  throw new Error(`ChatGPT image attachment is ready, but ZeroPOD could not keep the metadata prompt in the composer. ${lastError?.message || ''}`.trim());
}

MetadataController.prototype.generate = async function generateWithStableComposer(projectId) {
  const project = this.projects.read(projectId);
  if (!['approved-image', 'metadata-ready', 'metadata-recovery-needed'].includes(project.status)) {
    throw new Error('Image must pass review before generating metadata.');
  }
  if (!project.sourceUrl) throw new Error('Paste the Amazon/source link before generating POD WINNER metadata.');

  const approvedPath = project.approvedImagePath || project.generatedImagePath;
  if (!approvedPath || !fs.existsSync(approvedPath)) throw new Error('Approved design image is missing.');

  try {
    const { page } = await this.sessions.ensureService('chatgpt');
    await page.bringToFront();
    await this.chat.openPreferredThread(page);
    await this.chat.ensureReady(page);

    if (project.status === 'metadata-recovery-needed') {
      const existing = await this.consumeVisibleMetadata(page);
      if (existing?.metadata) return this.saveMetadata(projectId, project, existing.metadata);
    }

    this.projects.update(projectId, { status: 'metadata-generating', metadataError: null });

    const baselineAssistant = await this.assistantSnapshot(page);
    const baselineUsers = await this.userTurnCount(page);
    const prompt = this.buildPrompt(project);

    await this.chat.attachReference(page, approvedPath);
    await metadataAttachmentReady(this, page, 20000);

    const composer = await fillStableMetadataPrompt(this, page, prompt, 10000);
    await this.chat.sendPrompt(page, composer);

    const submitted = await this.waitForSubmission(page, baselineUsers, prompt.slice(0, 40), 15000);
    if (!submitted) throw new Error('ChatGPT metadata prompt remained in the composer instead of being submitted.');

    await this.rememberCurrentThread(page);

    try {
      const result = await this.waitForMetadata(page, baselineAssistant);
      return this.saveMetadata(projectId, project, result.metadata);
    } catch (parseError) {
      if (/responded|14 unique|JSON|metadata response/i.test(parseError.message)) {
        const repaired = await this.sendRepairRequest(page, parseError);
        return this.saveMetadata(projectId, project, repaired.metadata);
      }
      throw parseError;
    }
  } catch (error) {
    const recovery = automationError(
      'chatgpt',
      'metadata',
      error,
      'Keep the current ChatGPT thread open and press Retry Metadata. ZeroPOD will consume valid JSON already visible, otherwise it will wait for the approved-image attachment to stabilize before pasting and sending metadata.'
    );
    this.projects.update(projectId, { status: 'metadata-recovery-needed', metadataError: recovery });
    throw new Error(recovery.message);
  }
};

module.exports = { metadataAttachmentReady, fillStableMetadataPrompt };
