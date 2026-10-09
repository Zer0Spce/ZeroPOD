const { MetadataController } = require('./metadataController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function composerText(composer) {
  return composer.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || '';
    return element.innerText || element.textContent || '';
  }).catch(() => '');
}

async function sentState(page, composer, baselineUserCount, promptStart) {
  const userCount = await page.locator('[data-message-author-role="user"]').count().catch(() => baselineUserCount);
  if (userCount > baselineUserCount) return true;

  const text = (await composerText(composer)).trim();
  if (!text || !text.includes(promptStart)) return true;

  const stopVisible = await page.locator(
    'button[data-testid="stop-button"], button[aria-label*="stop" i], button[data-testid*="stop" i]'
  ).first().isVisible().catch(() => false);
  return stopVisible;
}

async function waitForSent(page, composer, baselineUserCount, promptStart, timeoutMs = 1800) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await sentState(page, composer, baselineUserCount, promptStart)) return true;
    await wait(120);
  }
  return false;
}

async function composerActionCandidate(page, composer) {
  const result = await composer.evaluate((element) => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    };

    const composerRect = element.getBoundingClientRect();
    let root = element;
    for (let i = 0; i < 7 && root.parentElement; i += 1) {
      root = root.parentElement;
      const rect = root.getBoundingClientRect();
      const buttons = [...root.querySelectorAll('button')].filter(visible);
      if (rect.width >= composerRect.width && buttons.length >= 1 && rect.height < 700) break;
    }

    const buttons = [...root.querySelectorAll('button')]
      .filter(visible)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
        const label = [
          button.getAttribute('aria-label') || '',
          button.getAttribute('title') || '',
          button.getAttribute('data-testid') || '',
          button.getAttribute('type') || '',
          button.innerText || ''
        ].join(' ').toLowerCase();
        return {
          button,
          disabled,
          label,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          centerY: rect.top + rect.height / 2
        };
      })
      .filter((item) => !item.disabled)
      .filter((item) => !/microphone|voice|dictat|record|attach|upload|add photo|add file|tools|model|stop/i.test(item.label) || /send|submit/i.test(item.label));

    const bandTop = composerRect.top - 110;
    const bandBottom = composerRect.bottom + 140;
    const candidates = buttons.filter((item) => item.centerY >= bandTop && item.centerY <= bandBottom);
    const pool = candidates.length ? candidates : buttons;
    if (!pool.length) return null;

    pool.sort((a, b) => {
      const aSemantic = /send|submit/i.test(a.label) ? 1 : 0;
      const bSemantic = /send|submit/i.test(b.label) ? 1 : 0;
      if (aSemantic !== bSemantic) return bSemantic - aSemantic;
      const aCompact = a.width <= 80 && a.height <= 80 ? 1 : 0;
      const bCompact = b.width <= 80 && b.height <= 80 ? 1 : 0;
      if (aCompact !== bCompact) return bCompact - aCompact;
      return b.right - a.right;
    });

    const target = pool[0];
    return {
      x: target.left + target.width / 2,
      y: target.top + target.height / 2,
      label: target.label
    };
  }).catch(() => null);

  return result;
}

async function requestComposerSubmit(composer) {
  return composer.evaluate((element) => {
    const form = element.closest('form');
    if (!form || typeof form.requestSubmit !== 'function') return false;
    form.requestSubmit();
    return true;
  }).catch(() => false);
}

MetadataController.prototype.submitPrompt = async function submitPromptPersistent(page, prompt) {
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
  const started = Date.now();
  let attempt = 0;

  // Keep trying until ChatGPT actually accepts the message. This intentionally
  // survives attachment-finalization and React hydration races instead of failing
  // immediately while the blue Send arrow is visibly ready.
  while (Date.now() - started < 45000) {
    if (await sentState(page, composer, baselineUserCount, promptStart)) return { ok: true };

    attempt += 1;

    // Enter is the most stable user-equivalent send path in ChatGPT. It is tried
    // first once the prompt is present, then retried periodically while the image
    // attachment finishes becoming sendable.
    await composer.click().catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    if (await waitForSent(page, composer, baselineUserCount, promptStart, 900)) return { ok: true };

    const candidate = await composerActionCandidate(page, composer);
    if (candidate) {
      await page.mouse.click(candidate.x, candidate.y).catch(() => {});
      if (await waitForSent(page, composer, baselineUserCount, promptStart, 1000)) return { ok: true };
    }

    if (attempt % 3 === 0) {
      await requestComposerSubmit(composer).catch(() => false);
      if (await waitForSent(page, composer, baselineUserCount, promptStart, 900)) return { ok: true };
    }

    await wait(500);
  }

  throw new Error('ChatGPT metadata prompt is still visible after repeated Send attempts. ZeroPOD did not start response parsing because the request never left the composer.');
};

module.exports = {};
