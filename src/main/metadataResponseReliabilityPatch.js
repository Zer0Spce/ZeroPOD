const { MetadataController } = require('./metadataController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function latestUserText(page) {
  const users = page.locator('[data-message-author-role="user"]');
  const count = await users.count().catch(() => 0);
  if (!count) return '';
  return (await users.nth(count - 1).innerText().catch(() => '')).trim();
}

async function newestAssistantText(page) {
  const assistants = page.locator('[data-message-author-role="assistant"]');
  const count = await assistants.count().catch(() => 0);
  if (!count) return { count: 0, text: '', code: '' };
  const newest = assistants.nth(count - 1);
  return {
    count,
    text: (await newest.innerText().catch(() => '')).trim(),
    code: (await newest.locator('pre, code').allInnerTexts().catch(() => [])).join('\n').trim()
  };
}

function isMetadataRequest(text) {
  return /POD WINNER MODE|Create SEO-ready Redbubble listing metadata|Produce the final metadata now/i.test(String(text || ''));
}

async function parseWholeConversationIfSafe(controller, page) {
  const userText = await latestUserText(page);
  if (!isMetadataRequest(userText)) return null;
  const conversationText = await page.locator('main').innerText().catch(() => '');
  if (!conversationText) return null;
  try {
    return { metadata: controller.parseMetadata(conversationText), raw: conversationText };
  } catch {
    return null;
  }
}

MetadataController.prototype.parseLatestVisibleAssistant = async function parseLatestVisibleAssistantScoped(page) {
  const newest = await newestAssistantText(page);
  for (const text of [newest.text, newest.code]) {
    if (!text) continue;
    try {
      return { metadata: this.parseMetadata(text), raw: text };
    } catch {}
  }
  return parseWholeConversationIfSafe(this, page);
};

MetadataController.prototype.waitForAssistantMetadata = async function waitForAssistantMetadataScoped(page, baseline, timeoutMs = 180000) {
  const started = Date.now();
  let latestText = '';
  let lastChangeAt = Date.now();
  let sawNewResponse = false;

  while (Date.now() - started < timeoutMs) {
    const newest = await newestAssistantText(page);
    const changedFromBaseline = newest.count > baseline.count || (newest.text && newest.text !== baseline.lastText);
    if (changedFromBaseline) {
      sawNewResponse = true;
      if (newest.text !== latestText) {
        latestText = newest.text;
        lastChangeAt = Date.now();
      }

      for (const text of [newest.text, newest.code]) {
        if (!text) continue;
        try {
          return { metadata: this.parseMetadata(text), raw: text };
        } catch {}
      }

      const stopVisible = await page.locator(
        'button[data-testid="stop-button"], button[aria-label*="stop" i], button[data-testid*="stop" i]'
      ).first().isVisible().catch(() => false);

      if (!stopVisible && Date.now() - lastChangeAt > 1800) {
        const fallback = await parseWholeConversationIfSafe(this, page);
        if (fallback?.metadata) return fallback;
      }
    }
    await wait(250);
  }

  const fallback = await parseWholeConversationIfSafe(this, page);
  if (fallback?.metadata) return fallback;

  const error = new Error(sawNewResponse
    ? 'ChatGPT returned a metadata response, but the newest response did not contain a valid Title + Main Tag + 14 Supporting Tags + Description JSON object.'
    : 'Timed out waiting for ChatGPT metadata response.');
  error.raw = latestText;
  throw error;
};

module.exports = {};
