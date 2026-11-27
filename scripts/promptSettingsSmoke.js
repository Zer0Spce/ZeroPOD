const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

const generation = read('src/main/generationPromptPatch.js');
const preload = read('src/main/preload.js');
const renderer = read('src/renderer/promptSettings.js');
const index = read('src/renderer/index.html');

for (const rule of [
  'make sure to add black stroke on the design',
  'DONT USE BLACK TEXT OR ELEMENTS',
  'ADD SOME SUBTLE GRUNGE',
  "DON'T CURVE THE TEXT IF NOT NECESARRY",
  'KEEP THE TEXT UNIFORMED',
  'USE MAXIMUM 2 COLORS FOR FONTS ONLY'
]) {
  assert(generation.includes(rule), `Updated default prompt is missing rule: ${rule}`);
}

assert(/ChatGPTController\.prototype\.buildPrompt/.test(generation), 'Generation controller prompt override is missing.');
assert(/return activePrompt\(\)/.test(generation), 'Generation must resolve the active default/custom prompt at runtime.');
assert(/generation-prompt-settings\.json/.test(generation), 'Prompt settings must persist under app data.');
assert(/prompt-settings:get/.test(generation), 'Prompt settings get IPC is missing.');
assert(/prompt-settings:save/.test(generation), 'Prompt settings save IPC is missing.');
assert(/prompt-settings:reset/.test(generation), 'Prompt settings reset IPC is missing.');
assert(/prompt-settings:paste-clipboard/.test(generation), 'Clipboard paste IPC is missing.');

assert(/promptSettings:\s*\{/.test(preload), 'Prompt settings bridge is missing from preload.');
assert(/pasteClipboard/.test(preload), 'Clipboard paste bridge is missing from preload.');
assert(/id="promptPasteCustom"/.test(renderer), 'Paste Custom Prompt button is missing.');
assert(/id="promptSave"/.test(renderer), 'Save Prompt button is missing.');
assert(/id="promptReset"/.test(renderer), 'Reset prompt button is missing.');
assert(/id="promptUseCustom"/.test(renderer), 'Use Custom Prompt toggle is missing.');
assert(/manual and Automation generations/i.test(renderer), 'Settings UI must explain that the prompt applies to manual and Automation generation.');
assert(/<script src="promptSettings\.js"><\/script>/.test(index), 'Prompt settings renderer must load from index.html.');

console.log('Generation prompt settings smoke passed.');
