const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of [
  'src/main/generationPromptPatch.js',
  'src/main/automationNewChatUiPatch.js',
  'src/main/sourceImageResolver.js',
  'src/main/sourceImageIpc.js',
  'src/renderer/automationNewChat.js',
  'src/renderer/sourceImageAutofetch.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

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
assert.match(uiPatch, /sourceImage\.resolve/);
assert.match(uiPatch, /no reference image attached · fetching from source URL/);
assert(uiPatch.indexOf('ensureSourceReferences(snapshot)') < uiPatch.indexOf("if (checkbox.checked && snapshot.state !== 'paused')"), 'Automation must fetch missing reference images before preparing New Chat.');
assert.equal((uiPatch.match(/generation\.newChat\(\)/g) || []).length, 1, 'Automation must invoke New Chat only once in its start path.');
assert.doesNotMatch(uiPatch, /newChat\s*:\s*true/);
assert.doesNotMatch(uiPatch, /automation\.update\([^\n]*newChat/);

const workflowAutofetch = read('src/renderer/sourceImageAutofetch.js');
assert.match(workflowAutofetch, /uwReferencePath/);
assert.match(workflowAutofetch, /uwSourceUrl/);
assert.match(workflowAutofetch, /sourceImage\.resolve/);
assert.match(workflowAutofetch, /Optional — leave empty to fetch from source URL/);
assert.match(workflowAutofetch, /button\.click\(\)/);

const resolver = read('src/main/sourceImageResolver.js');
assert.match(resolver, /source-image-cache/);
assert.match(resolver, /launchPersistentContext/);
assert.match(resolver, /headless: true/);
assert.match(resolver, /meta\[property="og:image"\]/);
assert.match(resolver, /data-a-dynamic-image/);
assert.match(resolver, /canonicalAmazonUrl/);
assert.match(resolver, /screenshotFallback/);
assert.match(resolver, /this\.cachedFor\(url\)/);

const preload = read('src/main/preload.js');
assert.match(preload, /sourceImage:\s*\{/);
assert.match(preload, /source-image:resolve/);

const ipc = read('src/main/sourceImageIpc.js');
assert.match(ipc, /ipcMain\.handle\('source-image:resolve'/);
assert.match(ipc, /resolver\.resolve/);

const injector = read('src/main/automationNewChatUiPatch.js');
assert.match(injector, /rendererScript\('automationNewChat\.js'\)/);
assert.match(injector, /rendererScript\('sourceImageAutofetch\.js'\)/);
assert.match(injector, /executeJavaScript/);
assert.match(injector, /automationNewChatOption/);

const bootstrap = read('src/main/bootstrap.js');
assert.match(bootstrap, /SessionManager\.prototype\.getLastThreadUrl\s*=/, 'Bootstrap must define getLastThreadUrl before ChatGPT thread preference patches load.');
assert.match(bootstrap, /SessionManager\.prototype\.rememberThreadUrl\s*=/, 'Bootstrap must define rememberThreadUrl.');
assert.match(bootstrap, /SessionManager\.prototype\.clearLastThreadUrl\s*=/, 'Bootstrap must define clearLastThreadUrl.');
assert.match(bootstrap, /SessionManager\.prototype\.isValidChatGPTThreadUrl\s*=/, 'Bootstrap must retain ChatGPT thread URL validation.');
assert(bootstrap.indexOf('SessionManager.prototype.getLastThreadUrl') < bootstrap.indexOf("require('./chatThreadPreferencePatch')"), 'Thread-session methods must be defined before chatThreadPreferencePatch loads.');
assert(bootstrap.indexOf("require('./chatThreadPreferencePatch')") < bootstrap.indexOf("require('./generationPromptPatch')"));
assert(bootstrap.indexOf("require('./automationControlPatch')") < bootstrap.indexOf("require('./automationNewChatUiPatch')"));
assert(bootstrap.indexOf("require('./automationNewChatUiPatch')") < bootstrap.indexOf("require('./sourceImageIpc')"));
assert(bootstrap.indexOf("require('./sourceImageIpc')") < bootstrap.indexOf("require('./main')"));

require('./sourceImageAutofetchSmoke');
console.log('Generation prompt + Automation New Chat + source-image autofetch + thread-session bootstrap smoke passed.');