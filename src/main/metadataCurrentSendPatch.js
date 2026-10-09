const { MetadataController } = require('./metadataController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function composerText(composer) {
  return composer.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || '';
    return element.innerText || element.textContent || '';
  }).catch(() => '');
}

async function userTurnCount(page) {
  return page.locator('[data-message-author-role="user"], [data-turn="user"], [data-conversation-role="user"]').count().catch(() => 0);
}

async function requestAccepted(page, composer, baselineUserCount, promptStart) {
  const count = await userTurnCount(page);
  if (count > baselineUserCount) return true;

  const text = (await composerText(composer)).trim();
  if (!text || !text.includes(promptStart)) return true;

  const stopVisible = await page.locator([
    'button[data-testid="stop-button"]',
    'button[aria-label*="stop generating" i]',
    'button[aria-label*="stop streaming" i]',
    'button[aria-label="Stop"]'
  ].join(',')).first().isVisible().catch(() => false);
  return stopVisible;
}

async function waitForAccepted(page, composer, baselineUserCount, promptStart, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await requestAccepted(page, composer, baselineUserCount, promptStart)) return true;
    await wait(120);
  }
  return false;
}

async function findEnabledSendButton(page, composer, timeoutMs = 15000) {
  const selectors = [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="send" i]',
    'button.composer-submit-btn',
    'button[type="submit"]'
  ];

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let scope = page.locator('body');
    const form = composer.locator('xpath=ancestor::form[1]');
    if (await form.count().catch(() => 0)) scope = form;

    for (const selector of selectors) {
      const buttons = scope.locator(selector);
      const count = await buttons.count().catch(() => 0);
      for (let index = count - 1; index >= 0; index -= 1) {
        const button = buttons.nth(index);
        const ready = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.pointerEvents !== 'none'
            && !element.disabled
            && element.getAttribute('aria-disabled') !== 'true';
        }).catch(() => false);
        if (ready) return button;
      }
    }
    await wait(100);
  }
  return null;
}

async function clickSend(page, button) {
  await button.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await button.click({ timeout: 2500 });
    return true;
  } catch {}

  const box = await button.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    return true;
  }

  return button.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  }).catch(() => false);
}

MetadataController.prototype.submitPrompt = async function submitPromptCurrentChatGPT(page, prompt) {
  let composer = await this.locateComposer(page);
  await composer.click({ timeout: 1500 });

  const promptStart = prompt.slice(0, Math.min(60, prompt.length));
  const existing = await composerText(composer);
  if (!existing.includes(promptStart)) {
    await composer.press('Control+A').catch(() => {});
    await composer.press('Backspace').catch(() => {});
    await page.keyboard.insertText(prompt);
  }

  const inserted = await composerText(composer);
  if (!inserted.includes(promptStart)) {
    throw new Error('ChatGPT metadata prompt was not inserted into the composer.');
  }

  const baselineUserCount = await userTurnCount(page);

  // Current ChatGPT exposes the blue arrow as #composer-submit-button. It may be
  // visible before attachments finish hydrating, so wait for the actual control to
  // become enabled instead of treating visibility as send-readiness.
  const button = await findEnabledSendButton(page, composer, 15000);
  if (button) {
    await clickSend(page, button);
    if (await waitForAccepted(page, composer, baselineUserCount, promptStart, 5000)) return true;
  }

  // If the click did not move the prompt, it is safe to try the normal keyboard
  // submission once because acceptance was explicitly not observed.
  composer = await this.locateComposer(page);
  if ((await composerText(composer)).includes(promptStart)) {
    await composer.click().catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    if (await waitForAccepted(page, composer, baselineUserCount, promptStart, 5000)) return true;
  }

  const state = await page.evaluate(() => {
    const button = document.querySelector('#composer-submit-button, button[data-testid="send-button"], button[aria-label="Send prompt"]');
    if (!button) return { found: false };
    const rect = button.getBoundingClientRect();
    return {
      found: true,
      id: button.id || '',
      testid: button.getAttribute('data-testid') || '',
      aria: button.getAttribute('aria-label') || '',
      disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true'),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }).catch(() => ({ found: false }));

  throw new Error(`ChatGPT kept the metadata prompt in the composer instead of sending it. Send control: ${JSON.stringify(state)}`);
};

module.exports = {};
