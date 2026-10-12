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

async function waitForComposerSafely(controller, page, timeout = 10000) {
  try {
    return await waitForComposer(controller, page, timeout);
  } catch {
    return null;
  }
}

async function prepareFreshChat(controller, page) {
  controller.sessions.clearLastThreadUrl?.('chatgpt');

  // Always navigate to the homepage for a new-chat request. Even when we are
  // already on `/`, a fresh navigation resets a half-loaded/stale composer state.
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await controller.assertNoHumanGate(page);

  let composer = await waitForComposerSafely(controller, page, 10000);
  if (composer) return composer;

  // ChatGPT occasionally renders the shell before the composer becomes usable.
  // Retry the homepage once instead of failing the automation row after 5 seconds.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await controller.assertNoHumanGate(page);

  if (typeof controller.ensureReady === 'function') {
    try {
      composer = await controller.ensureReady(page);
      if (composer) return composer;
    } catch {}
  }

  composer = await waitForComposerSafely(controller, page, 12000);
  if (composer) return composer;

  throw new Error('ChatGPT opened a fresh chat, but the message composer did not become ready after retrying. ZeroPOD did not send this job.');
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
      if (await waitForComposerSafely(this, page, 7000)) return;
    } catch {}
    this.sessions.clearLastThreadUrl?.('chatgpt');
  }

  if (!page.url().startsWith('https://chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  }

  if (!(await waitForComposerSafely(this, page, 7000)) && typeof this.ensureReady === 'function') {
    await this.ensureReady(page);
  }
};

// The optional newChat flag is intentionally per generation. When true, clear the
// remembered thread, open the homepage, and let ChatGPT create a new /c/... thread
// after Send. Subsequent unchecked generations then continue in that new thread.
ChatGPTController.prototype.start = async function startWithThreadPreference(payload = {}) {
  if (payload.newChat) {
    const { page } = await this.sessions.ensureService('chatgpt');
    await page.bringToFront();
    await prepareFreshChat(this, page);
  }
  return originalStart.call(this, payload);
};

ChatGPTController.prototype.newChat = async function newChatRemembered() {
  const { page } = await this.sessions.ensureService('chatgpt');
  await page.bringToFront();
  await prepareFreshChat(this, page);
  return {
    ok: true,
    message: 'Fresh ChatGPT conversation is ready. After the next prompt is sent, ZeroPOD will remember that new thread and reuse it until New Chat is requested again.'
  };
};

module.exports = {};
