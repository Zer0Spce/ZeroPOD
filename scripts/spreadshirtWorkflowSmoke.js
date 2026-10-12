const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const files = [
  'src/main/spreadshirtJourneyReliabilityPatch.js',
  'src/renderer/spreadshirtAlpha.js'
];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file} syntax failed: ${result.stderr || result.stdout}`);
}

const renderer = read('src/renderer/spreadshirtAlpha.js');
const journey = read('src/main/spreadshirtJourneyReliabilityPatch.js');
const bootstrap = read('src/main/bootstrap.js');

const orderedCalls = [
  'window.zeroPOD.metadata.generate',
  'window.zeroPOD.vectorizer.start',
  'api.exportPng',
  'api.deriveMetadata',
  'api.check',
  'api.prepare'
];
let previous = -1;
for (const token of orderedCalls) {
  const index = renderer.indexOf(token);
  assert(index > previous, `Spreadshirt automatic pipeline order is wrong around ${token}.`);
  previous = index;
}

assert(/Pass · Continue Workflow/.test(renderer), 'Image gate must have one Continue action.');
assert(/Check 2 · Spreadshirt Final Review/.test(renderer), 'Final review gate is missing.');
assert(/Pass · Publish/.test(renderer), 'Final review must have one Publish action.');
assert(!/id="ssGenerateMetadata"|id="ssVectorize"|id="ssExport"|id="ssBuildMetadata"|id="ssRunGate"|id="ssPrepare"/.test(renderer), 'Click-heavy manual pipeline controls returned.');
assert(/waitForMetadataEditor/.test(journey), 'Post-upload metadata navigation is missing.');
assert(/page\.frames\(\)/.test(journey), 'Metadata navigator must inspect all frames.');
assert(/Visible actions:/.test(journey) && /Visible fields:/.test(journey), 'Metadata failures must include live-DOM diagnostics.');
assert(/spreadshirt-final-review\.png/.test(journey), 'Final Spreadshirt review screenshot capture is missing.');

const regular = bootstrap.indexOf("require('./spreadshirtRegularExportPatch')");
const journeyIndex = bootstrap.indexOf("require('./spreadshirtJourneyReliabilityPatch')");
const ipc = bootstrap.indexOf("require('./spreadshirtAlphaIpc')");
assert(regular >= 0 && journeyIndex > regular && ipc > journeyIndex, 'Spreadshirt reliability load order is incorrect.');

console.log('Spreadshirt one-click workflow smoke checks passed.');
