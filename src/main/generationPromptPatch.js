const { app, clipboard, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { ChatGPTController } = require('./chatgptController');

const GENERATION_PROMPT = `-Copy slogan and create a style
-make It Clean and Print On demand Friendly
-avoid using specific colors and elements from last output unless i told you
-make sure that the font styling is different
-add some few elements. but don't add too much
-make the text Large Easy To Read
-Don't Use Cursive text unless defined.
-avoid adding element's on text
-make sure that the text are large and uniformed
-Avoid Using Ribbons
-don't do that fake transparent background. i want real transparent background
-make sure to add black stroke on the design
-make output 4:5
-Don't USE AI Brush Text
-DON'T ADD TEXT IF THE REFERENCE DOESN'T HAVE ONE.
-DONT USE BLACK TEXT OR ELEMENTS
-MAKE TEXT LARGE AND BIG.
-ADD SOME SUBTLE GRUNGE
-DON'T CURVE THE TEXT IF NOT NECESARRY
-KEEP THE TEXT UNIFORMED
-USE MAXIMUM 2 COLORS FOR FONTS ONLY
-IF THE reference is only text. add some few elements based on the text`;

const MAX_CUSTOM_PROMPT_LENGTH = 20000;

function promptSettingsFile() {
  return path.join(app.getPath('userData'), 'generation-prompt-settings.json');
}

function defaultSettings() {
  return {
    useCustomPrompt: false,
    customPrompt: '',
    updatedAt: null
  };
}

function normalizeSettings(value = {}) {
  const customPrompt = String(value.customPrompt || '').slice(0, MAX_CUSTOM_PROMPT_LENGTH);
  return {
    useCustomPrompt: Boolean(value.useCustomPrompt) && Boolean(customPrompt.trim()),
    customPrompt,
    updatedAt: value.updatedAt || null
  };
}

function readPromptSettings() {
  try {
    const file = promptSettingsFile();
    if (!fs.existsSync(file)) return defaultSettings();
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return defaultSettings();
  }
}

function writePromptSettings(settings) {
  const normalized = normalizeSettings({
    ...settings,
    updatedAt: new Date().toISOString()
  });
  const file = promptSettingsFile();
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.copyFileSync(temp, file);
  fs.rmSync(temp, { force: true });
  return normalized;
}

function activePrompt(settings = readPromptSettings()) {
  if (settings.useCustomPrompt && settings.customPrompt.trim()) return settings.customPrompt.trim();
  return GENERATION_PROMPT;
}

function promptSettingsSnapshot() {
  const settings = readPromptSettings();
  return {
    ...settings,
    defaultPrompt: GENERATION_PROMPT,
    activeMode: settings.useCustomPrompt && settings.customPrompt.trim() ? 'custom' : 'default',
    activePrompt: activePrompt(settings),
    maxCustomPromptLength: MAX_CUSTOM_PROMPT_LENGTH
  };
}

ChatGPTController.prototype.buildPrompt = function buildPromptUpdatedZeroPODBaseline() {
  return activePrompt();
};

ipcMain.handle('prompt-settings:get', () => promptSettingsSnapshot());

ipcMain.handle('prompt-settings:save', (_event, payload = {}) => {
  const customPrompt = String(payload.customPrompt || '').slice(0, MAX_CUSTOM_PROMPT_LENGTH);
  const useCustomPrompt = Boolean(payload.useCustomPrompt);
  if (useCustomPrompt && !customPrompt.trim()) {
    throw new Error('Paste or enter a custom prompt before enabling the custom prompt override.');
  }
  writePromptSettings({ useCustomPrompt, customPrompt });
  return promptSettingsSnapshot();
});

ipcMain.handle('prompt-settings:reset', () => {
  writePromptSettings(defaultSettings());
  return promptSettingsSnapshot();
});

ipcMain.handle('prompt-settings:paste-clipboard', () => ({
  text: String(clipboard.readText() || '').slice(0, MAX_CUSTOM_PROMPT_LENGTH)
}));

module.exports = {
  GENERATION_PROMPT,
  MAX_CUSTOM_PROMPT_LENGTH,
  readPromptSettings,
  promptSettingsSnapshot,
  activePrompt
};
