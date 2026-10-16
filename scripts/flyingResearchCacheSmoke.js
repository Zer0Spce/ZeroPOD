const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

const cache = read('src/renderer/flyingResearchCache.js');
const injector = read('src/main/flyingResearchCacheUiPatch.js');
const ipc = read('src/main/flyingResearchIpc.js');

assert(/api\.list\(\)/.test(cache), 'Flying cache must restore persisted ResearchStore designs.');
assert(/frRefresh/.test(cache) && /Refreshing…/.test(cache), 'Flying Research must expose an explicit Refresh button.');
assert(/frLoad/.test(cache), 'Cached cards must reuse the existing Show Imported renderer path.');
assert(/stopImmediatePropagation/.test(cache), 'Cached first-open path must prevent the old automatic live search.');
assert(/#frTools button\.active/.test(cache), 'Refresh must rerun the currently selected Flying Research tool.');
assert(/rendererScript\('flyingResearchCache\.js'\)/.test(injector), 'Flying cache renderer injection is missing.');
assert(/rendererReady/.test(injector) && /frCapture/.test(injector), 'Flying cache injection must wait for the real Flying Research renderer.');
assert(/setInterval/.test(injector) && /250/.test(injector), 'Flying cache injection must retry until the dynamic tab is ready.');
assert(/__zeroPODFlyingCacheInstalled/.test(injector), 'Flying cache injection must verify successful renderer installation.');
assert(/require\('\.\/flyingResearchCacheUiPatch'\)/.test(ipc), 'Flying Research IPC must load the cache UI patch.');

console.log('Flying Research cache + explicit Refresh smoke passed.');
