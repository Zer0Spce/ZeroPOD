const { MetadataController } = require('./metadataController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalAttachApprovedDesign = MetadataController.prototype.attachApprovedDesign;

// Metadata does not need the image-generation conversation context. Starting from
// a fresh ChatGPT composer avoids inheriting a stuck image-generation composer or
// an unsent metadata draft from a previous beta build. Recovery still gets a chance
// to harvest already-visible valid JSON before this method is called.
MetadataController.prototype.attachApprovedDesign = async function attachApprovedDesignFreshChat(page, project) {
  if (/^https:\/\/chatgpt\.com\/c\//i.test(page.url())) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await this.locateComposer(page);
  }
  return originalAttachApprovedDesign.call(this, page, project);
};

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

async function waitForSent(page, composer, baselineUserCount, promptStart, timeoutMs = 1200) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await sentState(page, composer, baselineUserCount, promptStart)) return true;
    await wait(100);
  }
  return false;
}

async function exactSendLocators(page, composer) {
  const scopes = [];
  const form = page.locator('form').filter({ has: composer }).first();
  if (await form.count().catch(() => 0)) scopes.push(form);
  scopes.push(page.locator('body'));

  const selectors = [
    'button[data-testid="send-button"]',
    'button[data-testid*="send" i]',
    'button[aria-label*="send prompt" i]',
    'button[aria-label*="send" i]',
    'button[aria-label*="submit" i]',
    'button[type="submit"]'
  ];

  const found = [];
  for (const scope of scopes) {
    for (const selector of selectors) {
      const locator = scope.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i -= 1) {
        const button = locator.nth(i);
        const usable = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const disabled = element.disabled || element.getAttribute('aria-disabled') === 'true';
          return !disabled && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).catch(() => false);
        if (usable) found.push(button);
      }
    }
    if (found.length) break;
  }
  return found;
}

async function geometricSendCandidate(composer) {
  return composer.evaluate((element) => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };

    const composerRect = element.getBoundingClientRect();
    let root = element;
    for (let i = 0; i < 8 && root.parentElement; i += 1) {
      root = root.parentElement;
      const rect = root.getBoundingClientRect();
      if (rect.width >= composerRect.width && rect.height <= 760 && root.querySelectorAll('button').length) break;
    }

    const candidates = [...root.querySelectorAll('button')]
      .filter(visible)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
        const label = [button.getAttribute('aria-label') || '', button.getAttribute('title') || '', button.getAttribute('data-testid') || '', button.innerText || ''].join(' ').toLowerCase();
        return { disabled, label, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, centerY: rect.top + rect.height / 2 };
      })
      .filter((item) => !item.disabled)
      .filter((item) => !/microphone|voice|dictat|record|attach|upload|add photo|add file|tools|model|stop/i.test(item.label) || /send|submit/i.test(item.label))
      .filter((item) => item.centerY >= composerRect.top - 120 && item.centerY <= composerRect.bottom + 160);

    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const as = /send|submit/i.test(a.label) ? 1 : 0;
      const bs = /send|submit/i.test(b.label) ? 1 : 0;
      if (as !== bs) return bs - as;
      const ac = a.width <= 84 && a.height <= 84 ? 1 : 0;
      const bc = b.width <= 84 && b.height <= 84 ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return b.right - a.right;
    });

    const target = candidates[0];
    return { x: target.left + target.width / 2, y: target.top + target.height / 2, label: target.label };
  }).catch(() => null);
}

async function requestComposerSubmit(composer) {
  return composer.evaluate((element) => {
    const form = element.closest('form');
    if (!form) return false;
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return true;
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit instanceof HTMLElement) {
      submit.click();
      return true;
    }
    return false;
  }).catch(() => false);
}

async function activateButton(page, button) {
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click({ force: true, timeout: 1200 }).catch(() => {});
  await wait(120);
  await button.evaluate((element) => {
    try { element.focus(); } catch {}
    try { element.click(); } catch {}
  }).catch(() => {});
  await wait(120);
  const box = await button.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    await wait(120);
  }
  await button.press('Enter').catch(() => {});
  await wait(120);
  await button.press('Space').catch(() => {});
}

async function sendDiagnostics(page, composer) {
  const handle = await composer.elementHandle().catch(() => null);
  if (!handle) return [];
  return page.evaluate((composerElement) => {
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const root = composerElement?.closest('form') || composerElement?.parentElement?.parentElement || document.body;
    return [...root.querySelectorAll('button')]
      .filter(visible)
      .slice(-12)
      .map((button) => ({
        testid: button.getAttribute('data-testid') || '',
        aria: button.getAttribute('aria-label') || '',
        title: button.getAttribute('title') || '',
        type: button.getAttribute('type') || '',
        disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true')
      }));
  }, handle).catch(() => []);
}

MetadataController.prototype.submitPrompt = async function submitPromptVerified(page, prompt) {
  let composer = await this.locateComposer(page);
  await composer.click({ timeout: 1500 });

  const promptStart = prompt.slice(0, Math.min(60, prompt.length));
  const current = await composerText(composer);
  if (!current.includes(promptStart)) {
    await composer.press('Control+A').catch(() => {});
    await composer.press('Backspace').catch(() => {});
    await page.keyboard.insertText(prompt);
  }

  const inserted = await composerText(composer);
  if (!inserted.includes(promptStart)) throw new Error('ChatGPT metadata prompt was not inserted into the composer.');

  const baselineUserCount = await page.locator('[data-message-author-role="user"]').count().catch(() => 0);
  const started = Date.now();
  let cycle = 0;

  while (Date.now() - started < 60000) {
    if (await sentState(page, composer, baselineUserCount, promptStart)) return { ok: true };
    cycle += 1;

    composer = await this.locateComposer(page);

    const exactButtons = await exactSendLocators(page, composer);
    for (const button of exactButtons) {
      await activateButton(page, button);
      if (await waitForSent(page, composer, baselineUserCount, promptStart, 900)) return { ok: true };
    }

    await composer.click().catch(() => {});
    await composer.press('Enter').catch(() => {});
    if (await waitForSent(page, composer, baselineUserCount, promptStart, 800)) return { ok: true };
    await composer.press('Control+Enter').catch(() => {});
    if (await waitForSent(page, composer, baselineUserCount, promptStart, 800)) return { ok: true };

    const candidate = await geometricSendCandidate(composer);
    if (candidate) {
      await page.mouse.click(candidate.x, candidate.y).catch(() => {});
      if (await waitForSent(page, composer, baselineUserCount, promptStart, 900)) return { ok: true };
    }

    if (cycle % 2 === 0) {
      await requestComposerSubmit(composer).catch(() => false);
      if (await waitForSent(page, composer, baselineUserCount, promptStart, 900)) return { ok: true };
    }

    await wait(350);
  }

  const diagnostics = await sendDiagnostics(page, composer);
  throw new Error(`ChatGPT kept the metadata prompt in the composer after 60 seconds. Send controls detected: ${JSON.stringify(diagnostics)}`);
};

module.exports = {};
