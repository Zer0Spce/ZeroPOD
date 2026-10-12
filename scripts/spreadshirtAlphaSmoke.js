const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const files = [
  'src/main/spreadshirtAlphaFeature.js',
  'src/main/spreadshirtAlphaIpc.js',
  'src/main/spreadshirtAlphaUiPatch.js',
  'src/main/flyingSpreadshirtPatch.js',
  'src/renderer/spreadshirtAlpha.js'
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file} failed syntax check: ${result.stderr || result.stdout}`);
}

const feature = read('src/main/spreadshirtAlphaFeature.js');
const renderer = read('src/renderer/spreadshirtAlpha.js');
const preload = read('src/main/preload.js');
const bootstrap = read('src/main/bootstrap.js');
const flyingIpc = read('src/main/flyingResearchIpc.js');
const flyingPatch = read('src/main/flyingSpreadshirtPatch.js');

assert(/DAILY_UPLOAD_LIMIT = 10/.test(feature), 'Spreadshirt daily limit must remain 10.');
assert(/ACCOUNT_UPLOAD_LIMIT = 50/.test(feature), 'Spreadshirt account limit must remain 50.');
assert(/MAX_DIMENSION = 4000/.test(feature), 'Spreadshirt artwork max dimension must remain 4000.');
assert(/MAX_FILE_BYTES = 10 \* 1024 \* 1024/.test(feature), 'Spreadshirt file limit must remain 10 MB.');
assert(/spreadshirt-4000\.png/.test(feature), 'Spreadshirt-specific PNG export is missing.');
assert(/validateListingMetadata/.test(feature) && /35 characters or fewer/.test(feature) && /200 characters or fewer/.test(feature), 'Spreadshirt metadata gates are missing.');
assert(/dailyBlocked/.test(feature) && /accountBlocked/.test(feature), 'Spreadshirt upload-limit gate checks are missing.');
assert(/could not verify Spreadshirt success/i.test(feature), 'Publish verification guard is missing.');

assert(/Spreadshirt <strong class="ss-alpha-mark">\[ALPHA\]<\/strong>/.test(renderer), 'Spreadshirt nav must render bold [ALPHA].');
assert(/Gate 1 · Generated Image/.test(renderer), 'Spreadshirt image approval gate is missing.');
assert(/Gate Checks/.test(renderer) && /Final Review/.test(renderer), 'Spreadshirt final gate UI is missing.');
assert(/10 \/ 10|dailyUsed/.test(renderer), 'Spreadshirt daily usage UI is missing.');
assert(/50/.test(renderer) && /ssAccountUsage/.test(renderer), 'Spreadshirt account usage UI is missing.');
assert(/Send to Spreadshirt/.test(renderer), 'Flying Research Send to Spreadshirt button is missing.');
assert(/data-action = 'spreadshirt'|dataset\.action = 'spreadshirt'/.test(renderer), 'Flying Spreadshirt card action is not wired.');
assert(/zeroPODSpreadshirtImport/.test(renderer), 'Flying-to-Spreadshirt import bridge is missing.');

assert(/spreadshirt:\s*\{/.test(preload), 'Spreadshirt preload API is missing.');
assert(/spreadshirt: \(key\) => ipcRenderer\.invoke\('flying:spreadshirt'/.test(preload), 'Flying Research Spreadshirt preload action is missing.');
assert(/flying:spreadshirt/.test(flyingIpc), 'Flying Research Spreadshirt IPC handler is missing.');
assert(/prototype\.spreadshirt/.test(flyingPatch), 'FlyingResearchFeature Spreadshirt handoff patch is missing.');

const patchIndex = bootstrap.indexOf("require('./flyingSpreadshirtPatch')");
const flyingIpcIndex = bootstrap.indexOf("require('./flyingResearchIpc')");
const ssIpcIndex = bootstrap.indexOf("require('./spreadshirtAlphaIpc')");
const ssUiIndex = bootstrap.indexOf("require('./spreadshirtAlphaUiPatch')");
const mainIndex = bootstrap.lastIndexOf("require('./main')");
assert(patchIndex >= 0 && patchIndex < flyingIpcIndex, 'Flying Spreadshirt prototype patch must load before Flying Research IPC.');
assert(ssIpcIndex >= 0 && ssIpcIndex < mainIndex, 'Spreadshirt IPC must load before main.');
assert(ssUiIndex >= 0 && ssUiIndex < mainIndex, 'Spreadshirt renderer injector must load before main.');

console.log('Spreadshirt Alpha smoke checks passed.');
