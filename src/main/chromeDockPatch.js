const { SessionManager } = require('./sessionManager');

// chatgptChromePatch is loaded before this file, so these references point to the
// proven Chrome automation transport. Automation Chrome remains fully rendered but
// off-screen. Connections -> Login Chrome remains visible for manual authentication.
const originalEnsureService = SessionManager.prototype.ensureService;
const originalCloseAutomationContext = SessionManager.prototype.closeAutomationContext;
const originalLaunchNormalLoginBrowser = SessionManager.prototype.launchNormalLoginBrowser;

async function keepAutomationWindowOffscreen(page) {
  if (!page || page.isClosed()) return;
  let session;
  try {
    session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    if (!windowId) return;
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: -20000, top: -20000, width: 1280, height: 900 }
    }).catch(() => {});
  } catch {}
  finally { if (session) await session.detach().catch(() => {}); }
}

async function showAutomationWindow(page) {
  if (!page || page.isClosed()) return;
  let session;
  try {
    session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    if (!windowId) return;
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 60, top: 60, width: 1360, height: 900 }
    }).catch(() => {});
  } catch {}
  finally { if (session) await session.detach().catch(() => {}); }
}

SessionManager.prototype.setHostWindow = function setHostWindowBackground(window) {
  this.__zeroPodHostWindow = window;
  return this;
};

SessionManager.prototype.beginWideService = async function beginWideServiceDisabled() {
  return true;
};

SessionManager.prototype.endWideService = async function endWideServiceDisabled() {
  return true;
};

SessionManager.prototype.setAutomationWindowVisible = function setAutomationWindowVisible(serviceId, visible = true) {
  this.__zeroPodVisibleAutomationServices ||= new Set();
  if (visible) this.__zeroPodVisibleAutomationServices.add(serviceId);
  else this.__zeroPodVisibleAutomationServices.delete(serviceId);
  return this;
};

SessionManager.prototype.ensureService = async function ensureServiceBackground(serviceId) {
  const result = await originalEnsureService.call(this, serviceId);
  if (this.__zeroPodVisibleAutomationServices?.has(serviceId)) {
    await showAutomationWindow(result.page);
  } else {
    await keepAutomationWindowOffscreen(result.page);
  }
  return result;
};

SessionManager.prototype.closeAutomationContext = async function closeAutomationContextBackground(serviceId) {
  return originalCloseAutomationContext.call(this, serviceId);
};

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserVisible(serviceId) {
  // Connections -> Login is the one place where the user explicitly needs to see
  // Chrome. Do not minimize, move off-screen, dock, or hide this native login handoff.
  return originalLaunchNormalLoginBrowser.call(this, serviceId);
};

module.exports = { keepAutomationWindowOffscreen, showAutomationWindow };
