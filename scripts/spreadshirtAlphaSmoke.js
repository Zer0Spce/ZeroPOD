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
  'src/main/spreadshirtRegularExportPatch.js',
  'src/main/spreadshirtJourneyReliabilityPatch.js',
  'src/main/spreadshirtUploadReliabilityPatch.js',
  'src/main/flyingSpreadshirtPatch.js',
  'src/renderer/spreadshirtAlpha.js',
  'src/renderer/spreadshirtRegularExportUiPatch.js'
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file} failed syntax check: ${result.stderr || result.stdout}`);
}

const feature = read('src/main/spreadshirtAlphaFeature.js');
const standardExport = read('src/main/spreadshirtRegularExportPatch.js');
const journey = read('src/main/spreadshirtJourneyReliabilityPatch.js');
const upload = read('src/main/spreadshirtUploadReliabilityPatch.js');
const renderer = read('src/renderer/spreadshirtAlpha.js');
const preload = read('src/main/preload.js');
const bootstrap = read('src/main/bootstrap.js');
const flyingIpc = read('src/main/flyingResearchIpc.js');
const flyingPatch = read('src/main/flyingSpreadshirtPatch.js');

assert(/DAILY_UPLOAD_LIMIT = 10/.test(feature), 'Spreadshirt daily limit must remain 10.');
assert(/ACCOUNT_UPLOAD_LIMIT = 50/.test(feature), 'Spreadshirt account limit must remain 50.');
assert(/validateListingMetadata/.test(feature) && /35 characters or fewer/.test(feature) && /200 characters or fewer/.test(feature), 'Spreadshirt metadata gates are missing.');
assert(/dailyBlocked/.test(feature) && /accountBlocked/.test(feature), 'Spreadshirt upload-limit gate checks are missing.');
assert(/could not verify Spreadshirt success/i.test(feature), 'Publish verification guard is missing.');

assert(/new ExportController/.test(standardExport), 'Spreadshirt must reuse the standard ZeroPOD ExportController.');
assert(/standard-zeropod-4500x5400/.test(standardExport), 'Spreadshirt standard 4500x5400 export marker is missing.');
assert(/info\.width !== 4500 \|\| info\.height !== 5400/.test(standardExport), 'Spreadshirt should expect the normal 4500x5400 ZeroPOD PNG.');
assert(!/MAX_SPREADSHIRT_DIMENSION|10 MB or smaller|spreadshirt-upload\.png/.test(standardExport), 'Spreadshirt must upload the normal 4500x5400 file directly.');

assert(/waitForMetadataEditor/.test(journey), 'Spreadshirt post-upload metadata navigator is missing.');
assert(/page\.frames\(\)/.test(journey), 'Spreadshirt metadata discovery must inspect frames.');
assert(/continue to details/i.test(journey) && /edit details/i.test(journey), 'Spreadshirt post-upload journey actions are missing.');
assert(/Visible actions:/.test(journey) && /Visible fields:/.test(journey), 'Spreadshirt metadata failure diagnostics are missing.');
assert(/reviewScreenshotPath/.test(journey), 'Spreadshirt final-review capture is missing.');

assert(/ensureRightsConfirmation/.test(upload), 'Spreadshirt copyright/license checkbox automation is missing.');
assert(/owner of the copyright/.test(upload) && /license rights/.test(upload), 'Spreadshirt rights confirmation matching is missing.');
assert(/#listFileInput/.test(upload) && /#hiddenFileInput/.test(upload), 'Spreadshirt current file inputs must be supported.');
assert(/Ooops!?\\s\*Snap/.test(upload) && /It didn/.test(upload), 'Spreadshirt upload error detection is missing.');
assert(/attempt <= 3/.test(upload), 'Spreadshirt upload must retry transient failures.');
assert(/waitForUploadProgress/.test(upload), 'Spreadshirt must wait for real upload progress before metadata.');
assert(!/MAX_SPREADSHIRT_DIMENSION|MAX_SPREADSHIRT_BYTES/.test(upload), 'Upload reliability must not reject the user-tested 4500x5400 file.');

assert(/Spreadshirt <strong class="ss-alpha-mark">\[ALPHA\]<\/strong>/.test(renderer), 'Spreadshirt nav must render bold [ALPHA].');
assert(/Check 1 · Generated Image/.test(renderer), 'Spreadshirt image approval gate is missing.');
assert(/Check 2 · Spreadshirt Final Review/.test(renderer), 'Spreadshirt final approval gate is missing.');
assert(/runPostApprovalPipeline/.test(renderer), 'Spreadshirt one-click continuation pipeline is missing.');
assert(/window\.zeroPOD\.metadata\.generate/.test(renderer), 'Spreadshirt pipeline must auto-generate metadata.');
assert(/window\.zeroPOD\.vectorizer\.start/.test(renderer), 'Spreadshirt pipeline must auto-vectorize.');
assert(/api\.exportPng/.test(renderer), 'Spreadshirt pipeline must auto-export.');
assert(/api\.deriveMetadata/.test(renderer), 'Spreadshirt pipeline must auto-build listing metadata.');
assert(/lastGate = await api\.check/.test(renderer), 'Spreadshirt pipeline must run gate checks automatically.');
assert(/api\.prepare/.test(renderer), 'Spreadshirt pipeline must prepare the upload automatically.');
assert(/Pass · Continue Workflow/.test(renderer), 'Spreadshirt image pass action must continue automatically.');
assert(/Pass · Publish/.test(renderer), 'Spreadshirt final pass action must publish.');
assert(!/id="ssGenerateMetadata"/.test(renderer), 'Manual Generate Metadata button must not return.');
assert(!/id="ssVectorize"/.test(renderer), 'Manual Vectorize button must not return.');
assert(!/id="ssExport"/.test(renderer), 'Manual Export button must not return.');
assert(!/id="ssBuildMetadata"/.test(renderer), 'Manual Build Metadata button must not return.');
assert(!/id="ssRunGate"/.test(renderer), 'Manual Gate Check button must not return.');
assert(!/id="ssPrepare"/.test(renderer), 'Manual Prepare button must not return.');
assert(/dailyUsed/.test(renderer), 'Spreadshirt daily usage UI is missing.');
assert(/50/.test(renderer) && /ssAccountUsage/.test(renderer), 'Spreadshirt account usage UI is missing.');
assert(/Send to Spreadshirt/.test(renderer), 'Flying Research Send to Spreadshirt button is missing.');
assert(/dataset\.action = 'spreadshirt'/.test(renderer), 'Flying Spreadshirt card action is not wired.');
assert(/zeroPODSpreadshirtImport/.test(renderer), 'Flying-to-Spreadshirt import bridge is missing.');

assert(/spreadshirt:\s*\{/.test(preload), 'Spreadshirt preload API is missing.');
assert(/spreadshirt: \(key\) => ipcRenderer\.invoke\('flying:spreadshirt'/.test(preload), 'Flying Research Spreadshirt preload action is missing.');
assert(/flying:spreadshirt/.test(flyingIpc), 'Flying Research Spreadshirt IPC handler is missing.');
assert(/prototype\.spreadshirt/.test(flyingPatch), 'FlyingResearchFeature Spreadshirt handoff patch is missing.');

const flyingPatchIndex = bootstrap.indexOf("require('./flyingSpreadshirtPatch')");
const flyingIpcIndex = bootstrap.indexOf("require('./flyingResearchIpc')");
const exportPatchIndex = bootstrap.indexOf("require('./spreadshirtRegularExportPatch')");
const journeyPatchIndex = bootstrap.indexOf("require('./spreadshirtJourneyReliabilityPatch')");
const uploadPatchIndex = bootstrap.indexOf("require('./spreadshirtUploadReliabilityPatch')");
const ssIpcIndex = bootstrap.indexOf("require('./spreadshirtAlphaIpc')");
const ssUiIndex = bootstrap.indexOf("require('./spreadshirtAlphaUiPatch')");
const mainIndex = bootstrap.lastIndexOf("require('./main')");
assert(flyingPatchIndex >= 0 && flyingPatchIndex < flyingIpcIndex, 'Flying Spreadshirt prototype patch must load before Flying Research IPC.');
assert(exportPatchIndex >= 0 && exportPatchIndex < journeyPatchIndex && journeyPatchIndex < uploadPatchIndex && uploadPatchIndex < ssIpcIndex, 'Spreadshirt export/journey/upload reliability patches must load before Spreadshirt IPC.');
assert(ssIpcIndex >= 0 && ssIpcIndex < mainIndex, 'Spreadshirt IPC must load before main.');
assert(ssUiIndex >= 0 && ssUiIndex < mainIndex, 'Spreadshirt renderer injector must load before main.');

console.log('Spreadshirt Alpha streamlined workflow smoke checks passed.');
