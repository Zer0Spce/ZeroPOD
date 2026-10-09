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

function isValidChatGPTThreadUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') return false;
    if (url.pathname === '/' || url.pathname === '') return true;

    const match = url.pathname.match(/^\/c\/([A-Za-z0-9-]+)$/);
    if (!match) return false;

    const id = match[1];
    if (/^local-chatgpt/i.test(id)) return false;
    if (id.length < 20) return false;
    return true;
  } catch {
    return false;
  }
}

SessionManager.prototype.getLastThreadUrl = function getLastThreadUrl(serviceId) {
  const value = readThreadState()[serviceId]?.lastThreadUrl || null;
  if (serviceId === 'chatgpt' && value && !isValidChatGPTThreadUrl(value)) {
    this.clearLastThreadUrl?.(serviceId);
    return null;
  }
  return value;
};

SessionManager.prototype.rememberThreadUrl = function rememberThreadUrl(serviceId, url) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (serviceId === 'chatgpt' && !isValidChatGPTThreadUrl(value)) {
    return this.getLastThreadUrl(serviceId);
  }
  const state = readThreadState();
  state[serviceId] = { ...(state[serviceId] || {}), lastThreadUrl: value, updatedAt: new Date().toISOString() };
  writeThreadState(state);
  return value;
};

SessionManager.prototype.clearLastThreadUrl = function clearLastThreadUrl(serviceId) {
  const state = readThreadState();
  if (!state[serviceId]) return false;
  delete state[serviceId].lastThreadUrl;
  state[serviceId].updatedAt = new Date().toISOString();
  writeThreadState(state);
  return true;
};

SessionManager.prototype.isValidChatGPTThreadUrl = function isValidChatGPTThreadUrlForSession(url) {
  return isValidChatGPTThreadUrl(url);
};

require('./chatgptChromePatch');
require('./chromeDockPatch');
require('./chatgptUploadReadyPatch');
require('./chatgptNetworkCapturePatch');
require('./chatgptLiveReliabilityPatch');
require('./chatThreadPreferencePatch');
require('./metadataVisibleJsonPatch');
require('./metadataComposerStabilityPatch');
require('./redbubbleVectorizerSpeedPatch');
require('./main');
