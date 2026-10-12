const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const promptPatch = read('src/main/generationPromptPatch.js');
const requiredPromptLines = [
  '-Copy slogan and create a style',
  '-make sure to add black stroke on the design',
  '-DONT USE BLACK TEXT OR ELEMENTS',
  '-MAKE TEXT LARGE AND BIG.',
  '-make output 4:5',
  '-DON\'T ADD TEXT IF THE REFERENCE DOESN\'T HAVE ONE.'
];
for (const line of requiredPromptLines) assert(promptPatch.includes(line), `Generation prompt is missing: ${line}`);
assert.match(promptPatch, /ChatGPTController\.prototype\.buildPrompt/);

const uiPatch = read('src/renderer/automationNewChat.js');
assert.match(uiPatch, /id="automationNewChatV2"/);
assert.match(uiPatch, /generation\.newChat\(\)/);
assert.match(uiPatch, /Every row in this run will reuse this same chat/);
assert.match(uiPatch, /snapshot\.state !== 'paused'/);
assert.equal((uiPatch.match(/generation\.newChat\(\)/g) || []).length, 1, 'Automation must invoke New Chat only once in its start path.');
assert.doesNotMatch(uiPatch, /newChat\s*:\s*true/);
assert.doesNotMatch(uiPatch, /automation\.update\([^\n]*newChat/);

const injector = read('src/main/automationNewChatUiPatch.js');
assert.match(injector, /automationNewChat\.js/);
assert.match(injector, /currentUrl\.startsWith\('file:'\)/);

const bootstrap = read('src/main/bootstrap.js');
assert(bootstrap.indexOf("require('./chatThreadPreferencePatch')") < bootstrap.indexOf("require('./generationPromptPatch')"));
assert(bootstrap.indexOf("require('./automationControlPatch')") < bootstrap.indexOf("require('./automationNewChatUiPatch')"));
assert(bootstrap.indexOf("require('./automationNewChatUiPatch')") < bootstrap.indexOf("require('./main')"));

console.log('Generation prompt + Automation New Chat smoke passed: exact new prompt rules and one fresh chat per Automation run are wired.');
