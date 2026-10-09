const { MetadataController } = require('./metadataController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function composerText(composer) {
  return composer.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || '';
    return element.innerText || element.textContent || '';
  }).catch(() => '');
}

async function composerScope(composer, page) {
  const form = page.locator('form').filter({ has: composer }).first();
  if (await form.count().catch(() => 0)) return form;
  return page.locator('body');
}

async function bestComposerSendButton(page, composer) {
  const scope = await composerScope(composer, page);
  const scopeBox = await scope.boundingBox().catch(() => null);
  const buttons = scope.locator('button');
  const count = await buttons.count().catch(() => 0);
  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const info = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const disabled = element.disabled || element.getAttribute('aria-disabled') === 'true';
      const label = [
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || '',
        element.getAttribute('data-testid') || '',
        element.getAttribute('type') || '',
        element.innerText || ''
      ].join(' ').toLowerCase();
      return {
        disabled,
        visible: style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        label
      };
    }).catch(() => null);

    if (!info || !info.visible || info.disabled) continue;
    if (/voice|microphone|dictat|record|attach|upload|add file|add photo|tools|model|stop/i.test(info.label) && !/send|submit/i.test(info.label)) continue;

    const semantic = /send|submit/i.test(info.label);
    const nearRight = !scopeBox || info.right >= scopeBox.x + scopeBox.width - 120;
    if (!semantic && !nearRight) continue;

    const compactAction = info.width <= 72 && info.height <= 72;
    const score = (semantic ? 100000 : 0) + (compactAction ? 1000 : 0) + info.right;
    if (score > bestScore) {
      best = button;
      bestScore = score;
    }
  }

  return best;
}

async function sendConfirmed(page, composer, baselineUserCount, promptStart) {
  const started = Date.now();
  while (Date.now() - started < 6500) {
    const userCount = await page.locator('[data-message-author-role="user"]').count().catch(() => baselineUserCount);
    if (userCount > baselineUserCount) return true;

    const text = (await composerText(composer)).trim();
    if (!text || !text.includes(promptStart)) return true;

    const stopVisible = await page.locator(
      'button[data-testid="stop-button"], button[aria-label*="stop" i], button[data-testid*="stop" i]'
    ).first().isVisible().catch(() => false);
    if (stopVisible) return true;

    await wait(150);
  }
  return false;
}

async function requestComposerSubmit(page, composer) {
  return composer.evaluate((element) => {
    const form = element.closest('form');
    if (!form || typeof form.requestSubmit !== 'function') return false;
    form.requestSubmit();
    return true;
  }).catch(() => false);
}

MetadataController.prototype.submitPrompt = async function submitPromptConfirmed(page, prompt) {
  const composer = await this.locateComposer(page);
  await composer.click({ timeout: 1500 });

  const promptStart = prompt.slice(0, Math.min(60, prompt.length));
  const current = await composerText(composer);
  if (!current.includes(promptStart)) {
    await composer.press('Control+A').catch(() => {});
    await composer.press('Backspace').catch(() => {});
    await page.keyboard.insertText(prompt);
  }

  const inserted = await composerText(composer);
  if (!inserted.includes(promptStart)) {
    throw new Error('ChatGPT metadata prompt was not inserted into the composer.');
  }

  const baselineUserCount = await page.locator('[data-message-author-role="user"]').count().catch(() => 0);

  // The current ChatGPT UI may expose the blue arrow without stable send-specific
  // attributes. Select from the composer itself and fall back to the right-most
  // enabled compact action button, which is the visible blue Send arrow.
  let sendButton = null;
  const readyStarted = Date.now();
  while (Date.now() - readyStarted < 20000) {
    sendButton = await bestComposerSendButton(page, composer);
    if (sendButton) break;
    await wait(150);
  }

  if (!sendButton) {
    throw new Error('ChatGPT did not expose an enabled Send action for the metadata prompt.');
  }

  // 1) Normal trusted Playwright click.
  await sendButton.click({ timeout: 2500 }).catch(() => {});
  if (await sendConfirmed(page, composer, baselineUserCount, promptStart)) return { ok: true };

  // 2) Physical mouse click on the exact blue composer action. This avoids cases
  // where ChatGPT replaces the button node while React is hydrating the composer.
  const box = await sendButton.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    if (await sendConfirmed(page, composer, baselineUserCount, promptStart)) return { ok: true };
  }

  // 3) Native form submission, independent of button attributes.
  if (await requestComposerSubmit(page, composer)) {
    if (await sendConfirmed(page, composer, baselineUserCount, promptStart)) return { ok: true };
  }

  // 4) Keyboard submission as a final user-equivalent fallback.
  await composer.click().catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  if (await sendConfirmed(page, composer, baselineUserCount, promptStart)) return { ok: true };

  throw new Error('ChatGPT metadata prompt is visible and ready, but Send did not fire. ZeroPOD stopped before parsing so it will not report a false metadata error.');
};

module.exports = {};
