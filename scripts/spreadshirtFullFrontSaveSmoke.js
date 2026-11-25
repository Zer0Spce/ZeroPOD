const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const placementFile = path.join(root, 'src/main/spreadshirtRecordedPlacementPatch.js');
const source = fs.readFileSync(placementFile, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const syntax = spawnSync(process.execPath, ['--check', placementFile], { encoding: 'utf8' });
assert(syntax.status === 0, `spreadshirtRecordedPlacementPatch.js syntax failed: ${syntax.stderr || syntax.stdout}`);

assert(/fullFrontSelectionState/.test(source), 'Full front selected-state detector is missing.');
assert(/productSettingsSaveState/.test(source), 'Product settings Save-state detector is missing.');
assert(/initialState\.found && initialState\.selected === true/.test(source), 'Already-selected Full front path is missing.');
assert(/already-selected-back/.test(source), 'Already-selected Full front must exit without requiring Save.');
assert(/lastSaveState\.found && lastSaveState\.disabled/.test(source), 'Disabled Save recovery is missing.');
assert(/disabled-save-already-full-front/.test(source), 'Disabled Save + selected Full front success path is missing.');
assert(/waitForDesignProductsFullFront/.test(source), 'Design products Full front verification is missing.');
assert(/Save was clicked, but Full front was not confirmed/.test(source), 'Save click must be verified against the Design products summary.');
assert(/originalWaitForProductsCreated\(page, 45000\)/.test(source), 'Placement changes must still wait for product regeneration.');
assert(!/Product settings “Save” button was not found/.test(source), 'Old brittle Save-not-found failure must not remain.');

console.log('Spreadshirt Full front + disabled Save recovery smoke checks passed.');
