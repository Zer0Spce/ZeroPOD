const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of [
  'src/main/sourceImageResolver.js',
  'src/main/sourceImageIpc.js',
  'src/renderer/sourceImageAutofetch.js',
  'src/renderer/automationNewChat.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

const workflow = read('src/renderer/sourceImageAutofetch.js');
assert.match(workflow, /if \(referencePath \|\| !sourceUrl\) return;/);
assert.match(workflow, /sourceImage\.resolve\(sourceUrl\)/);
assert.match(workflow, /referenceInput\.value = result\.path/);
assert.match(workflow, /button\.click\(\)/);

const automation = read('src/renderer/automationNewChat.js');
assert.match(automation, /ensureSourceReferences/);
assert.match(automation, /!String\(row\.referenceImage \|\| ''\)\.trim\(\)/);
assert.match(automation, /sourceImage\.resolve\(sourceUrl\)/);
assert.match(automation, /patch: \{ referenceImage: result\.path \}/);
assert.match(automation, /A reference image is optional/);
assert(automation.indexOf('ensureSourceReferences(snapshot)') < automation.indexOf("generation.newChat()"));

const resolver = read('src/main/sourceImageResolver.js');
assert.match(resolver, /canonicalAmazonUrl/);
assert.match(resolver, /og:image/);
assert.match(resolver, /twitter:image/);
assert.match(resolver, /data-a-dynamic-image/);
assert.match(resolver, /screenshotFallback/);
assert.match(resolver, /source-image-cache/);
assert.match(resolver, /cachedFor\(url\)/);

const injector = read('src/main/automationNewChatUiPatch.js');
assert.match(injector, /rendererScript\('automationNewChat\.js'\)/);
assert.match(injector, /rendererScript\('sourceImageAutofetch\.js'\)/);
assert.match(injector, /automationNewChatOption/);

console.log('Source image autofetch smoke passed: Workflow and Automation accept URL-only jobs and Automation New Chat is directly injected.');
