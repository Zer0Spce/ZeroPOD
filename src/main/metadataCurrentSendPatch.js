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

async function isReadyButton(button) {
  return button.evaluate((element) => {
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
}

async function findSemanticSendButton(page) {
  const selectors = [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid*="send" i]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="send" i]',
    'button.composer-submit-btn',
    'button[type="submit"]'
  ];

  // Search the full page. The current ChatGPT DOM can place the blue arrow outside
  // the contenteditable's nearest <form>, so restricting the search to that form
  // misses the exact visible button.
  for (const selector of selectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const button = buttons.nth(index);
      if (await isReadyButton(button)) return button;
    }
  }
  return null;
}

async function findGeometricSendButton(page, composer) {
  const composerBox = await composer.boundingBox().catch(() => null);
  if (!composerBox) return null;

  const buttons = page.locator('button');
  const count = await buttons.count().catch(() => 0);
  const targetX = composerBox.x + composerBox.width;
  const targetY = composerBox.y + composerBox.height;
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await isReadyButton(button))) continue;
    const box = await button.boundingBox().catch(() => null);
    if (!box) continue;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // The send arrow is normally at the lower-right edge of the composer shell.
    // Allow some vertical slack because long metadata prompts make the editable
    // region tall while the action row remains pinned to the bottom.
    const rightEnough = centerX >= composerBox.x + composerBox.width * 0.55;
    const nearComposer = centerY >= composerBox.y - 140 && centerY <= composerBox.y + composerBox.height + 180;
    if (!rightEnough || !nearComposer) continue;

    const dx = Math.abs(targetX - centerX);
    const dy = Math.abs(targetY - centerY);
    const sizePenalty = (box.width > 90 || box.height > 90) ? 200 : 0;
    candidates.push({ index, score: dx + dy * 1.4 + sizePenalty });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates.length ? buttons.nth(candidates[0].index) : null;
}

async function findEnabledSendButton(page, composer, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const semantic = await findSemanticSendButton(page);
    if (semantic) return semantic;

    const geometric = await findGeometricSendButton(page, composer);
    if (geometric) return geometric;

    await wait(100);
  }
  return null;
}

async function clickSend(page, button) {
  await button.scrollIntoViewIfNeeded().catch(() => {});

  // Playwright click first: this is the closest equivalent to the user clicking
  // the visible blue arrow in Chrome.
  try {
    await button.click({ timeout: 2500, force: true });
    return true;
  } catch {}

  // Then a physical coordinate click through the attached Chrome page.
  const box = await button.boundingBox().catch(() => null);
  if (box) {
    try {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return true;
    } catch {}
  }

  // Final DOM click for React layouts where the locator is valid but Playwright's
  // hit testing is blocked by a transient overlay.
  return button.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  }).catch(() => false);
}

async function submitViaComposerForm(page, composer) {
  return composer.evaluate((element) => {
    let node = element;
    for (let depth = 0; depth < 10 && node; depth += 1, node = node.parentElement) {
      if (node instanceof HTMLFormElement) {
        if (typeof node.requestSubmit === 'function') node.requestSubmit();
        else node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return true;
      }
    }
    return false;
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

  // The approved image can still be finishing attachment hydration after the text
  // is already visible. Wait for either a semantic send control or the enabled
  // bottom-right composer action instead of assuming visibility means readiness.
  const button = await findEnabledSendButton(page, composer, 20000);
  if (button) {
    await clickSend(page, button);
    if (await waitForAccepted(page, composer, baselineUserCount, promptStart, 7000)) return true;
  }

  // Re-resolve the composer because ChatGPT frequently replaces the editable node
  // after attachment hydration.
  composer = await this.locateComposer(page);
  if ((await composerText(composer)).includes(promptStart)) {
    // Try native form submission before keyboard fallback.
    await submitViaComposerForm(page, composer);
    if (await waitForAccepted(page, composer, baselineUserCount, promptStart, 4000)) return true;
  }

  composer = await this.locateComposer(page);
  if ((await composerText(composer)).includes(promptStart)) {
    await composer.click().catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    if (await waitForAccepted(page, composer, baselineUserCount, promptStart, 5000)) return true;
  }

  const state = await page.evaluate(() => {
    const semantic = document.querySelector('#composer-submit-button, button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]');
    const visibleButtons = [...document.querySelectorAll('button')]
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          id: button.id || '',
          testid: button.getAttribute('data-testid') || '',
          aria: button.getAttribute('aria-label') || '',
          disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        };
      })
      .filter((item) => item.visible)
      .slice(-20);
    return {
      semantic: semantic ? {
        id: semantic.id || '',
        testid: semantic.getAttribute('data-testid') || '',
        aria: semantic.getAttribute('aria-label') || '',
        disabled: Boolean(semantic.disabled || semantic.getAttribute('aria-disabled') === 'true')
      } : null,
      visibleButtons
    };
  }).catch(() => ({ semantic: null, visibleButtons: [] }));

  throw new Error(`ChatGPT kept the metadata prompt in the composer instead of sending it. Send diagnostics: ${JSON.stringify(state)}`);
};

module.exports = {};
