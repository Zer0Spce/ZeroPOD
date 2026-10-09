const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { SessionManager } = require('./sessionManager');

function threadStatePath() {
  return path.join(app.getPath('userData'), 'thread-state.json');
}

function readThreadState() {
  try {
    const file = threadStatePath();
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  } catch {
    return {};
  }
}

function writeThreadState(state) {
  const file = threadStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}

SessionManager.prototype.getLastThreadUrl = function getLastThreadUrl(serviceId) {
  return readThreadState()[serviceId]?.lastThreadUrl || null;
};

SessionManager.prototype.rememberThreadUrl = function rememberThreadUrl(serviceId, url) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (serviceId === 'chatgpt' && !/^https:\/\/chatgpt\.com\/(?:c\/[^/?#]+)?(?:[?#].*)?$/i.test(value)) {
    return this.getLastThreadUrl(serviceId);
  }
  const state = readThreadState();
  state[serviceId] = { ...(state[serviceId] || {}), lastThreadUrl: value, updatedAt: new Date().toISOString() };
  writeThreadState(state);
  return value;
};

require('./chatgptUploadReadyPatch');
require('./chatgptNetworkCapturePatch');
require('./main');
