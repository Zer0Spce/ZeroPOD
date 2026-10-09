const { MetadataController } = require('./metadataController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function composerText(composer) {
  return composer.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || '';
    return element.innerText || element.textContent || '';
  }).catch(() => '');
}

async function visibleEnabledSendButton(page) {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[data-testid*="send" i]',
    'button[aria-label*="send" i]',
    'button[type="submit"]'
  ];

  for (const selector of selectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const usable = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const disabled = element.disabled || element.getAttribute('aria-disabled') === 'true';
        return !disabled && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }).catch(() => false);
      if (usable) return button;
    }
  }
  return null;
}

async function sendConfirmed(page, composer, baselineUserCount) {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    const userCount = await page.locator('[data-message-author-role="user"]').count().catch(() => baselineUserCount);
    if (userCount > baselineUserCount) return true;

    const text = (await composerText(composer)).trim();
    if (!text) return true;

    const stopVisible = await page.locator(
      'button[data-testid="stop-button"], button[aria-label*="stop" i], button[data-testid*="stop" i]'
    ).first().isVisible().catch(() => false);
    if (stopVisible) return true;

    await wait(200);
  }
  return false;
}

MetadataController.prototype.submitPrompt = async function submitPromptConfirmed(page, prompt) {
  const composer = await this.locateComposer(page);
  await composer.click();

  const current = await composerText(composer);
  if (!current.includes(prompt.slice(0, Math.min(60, prompt.length)))) {
    await composer.press('Control+A').catch(() => {});
    await composer.press('Backspace').catch(() => {});
    await page.keyboard.insertText(prompt);
  }

  const inserted = await composerText(composer);
  if (!inserted.includes(prompt.slice(0, Math.min(60, prompt.length)))) {
    throw new Error('ChatGPT metadata prompt was not inserted into the composer.');
  }

  const baselineUserCount = await page.locator('[data-message-author-role="user"]').count().catch(() => 0);

  // Do not treat a visible but disabled Send button as success. ChatGPT often
  // keeps Send disabled briefly while the attached approved image is finalizing.
  let sendButton = null;
  const readyStarted = Date.now();
  while (Date.now() - readyStarted < 45000) {
    sendButton = await visibleEnabledSendButton(page);
    if (sendButton) break;
    await wait(200);
  }

  if (!sendButton) {
    throw new Error('ChatGPT did not enable Send for the metadata prompt. The approved image may still be uploading.');
  }

  // First attempt: click the real enabled Send button.
  await sendButton.click({ timeout: 4000 }).catch(async () => {
    await sendButton.evaluate((element) => element.click()).catch(() => {});
  });

  if (await sendConfirmed(page, composer, baselineUserCount)) return { ok: true };

  // One recovery attempt for UI races: refocus the composer, then Enter.
  await composer.click().catch(() => {});
  await composer.press('Enter').catch(() => {});
  if (await sendConfirmed(page, composer, baselineUserCount)) return { ok: true };

  // Final recovery: the Send control may have been replaced during hydration.
  sendButton = await visibleEnabledSendButton(page);
  if (sendButton) {
    await sendButton.evaluate((element) => element.click()).catch(() => {});
    if (await sendConfirmed(page, composer, baselineUserCount)) return { ok: true };
  }

  throw new Error('ChatGPT metadata prompt was pasted but was not sent. ZeroPOD stopped before response parsing to avoid a false metadata error.');
};

module.exports = {};
