const { SessionManager } = require('./sessionManager');

// chatgptChromePatch is loaded before this file, so these references point to the
// proven Chrome automation transport. This patch intentionally stops resizing or
// surfacing automation Chrome windows. Login browsers remain normal visible Chrome.
const originalEnsureService = SessionManager.prototype.ensureService;
const originalCloseAutomationContext = SessionManager.prototype.closeAutomationContext;
const originalLaunchNormalLoginBrowser = SessionManager.prototype.launchNormalLoginBrowser;

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

SessionManager.prototype.ensureService = async function ensureServiceBackground(serviceId) {
  return originalEnsureService.call(this, serviceId);
};

SessionManager.prototype.closeAutomationContext = async function closeAutomationContextBackground(serviceId) {
  return originalCloseAutomationContext.call(this, serviceId);
};

SessionManager.prototype.launchNormalLoginBrowser = async function launchNormalLoginBrowserVisible(serviceId) {
  // Connections -> Login is the one place where the user explicitly needs to see
  // Chrome. Do not minimize, dock, or hide this native login handoff.
  return originalLaunchNormalLoginBrowser.call(this, serviceId);
};

module.exports = {};
