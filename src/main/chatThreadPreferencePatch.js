const { ChatGPTController } = require('./chatgptController');

const originalStart = ChatGPTController.prototype.start;

function isRealThread(value) {
  return /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{20,}$/i.test(String(value || ''));
}

async function waitForComposer(controller, page, timeout = 5000) {
  const composer = controller.composerLocator(page);
  await composer.waitFor({ state: 'visible', timeout });
  return composer;
}

// Default behavior: keep working in the last real ChatGPT conversation. A ready
// homepage composer must not silently replace the remembered /c/... thread.
ChatGPTController.prototype.openPreferredThread = async function openPreferredThreadRemembered(page) {
  const current = page.url();
  if (isRealThread(current)) {
    this.sessions.rememberThreadUrl('chatgpt', current);
    return;
  }

  const saved = this.sessions.getLastThreadUrl('chatgpt');
  if (isRealThread(saved)) {
    try {
      await page.goto(saved, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await waitForComposer(this, page, 5000);
      return;
    } catch {
      this.sessions.clearLastThreadUrl?.('chatgpt');
    }
  }

  if (!page.url().startsWith('https://chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  await waitForComposer(this, page, 5000);
};

// The optional newChat flag is intentionally per generation. When true, clear the
// remembered thread, open the homepage, and let ChatGPT create a new /c/... thread
// after Send. Subsequent unchecked generations then continue in that new thread.
ChatGPTController.prototype.start = async function startWithThreadPreference(payload = {}) {
  if (payload.newChat) {
    const { page } = await this.sessions.ensureService('chatgpt');
    await page.bringToFront();
    this.sessions.clearLastThreadUrl?.('chatgpt');
    if (page.url() !== 'https://chatgpt.com/' && page.url() !== 'https://chatgpt.com') {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
    await waitForComposer(this, page, 5000);
  }
  return originalStart.call(this, payload);
};

ChatGPTController.prototype.newChat = async function newChatRemembered() {
  const { page } = await this.sessions.ensureService('chatgpt');
  await page.bringToFront();
  this.sessions.clearLastThreadUrl?.('chatgpt');
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await this.assertNoHumanGate(page);
  await waitForComposer(this, page, 5000);
  return {
    ok: true,
    message: 'Fresh ChatGPT conversation is ready. After the next prompt is sent, ZeroPOD will remember that new thread and reuse it until New Chat is requested again.'
  };
};

module.exports = {};
