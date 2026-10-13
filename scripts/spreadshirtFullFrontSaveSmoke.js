const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const placementFile = path.join(root, 'src/main/spreadshirtRecordedPlacementPatch.js');
const recoveryFile = path.join(root, 'src/main/spreadshirtProductSettingsSaveRecoveryPatch.js');
const source = fs.readFileSync(placementFile, 'utf8');
const recovery = fs.readFileSync(recoveryFile, 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'src/main/bootstrap.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const file of [placementFile, recoveryFile]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert(syntax.status === 0, `${path.basename(file)} syntax failed: ${syntax.stderr || syntax.stdout}`);
}

assert(/fullFrontSelectionState/.test(source), 'Full front selected-state detector is missing.');
assert(/productSettingsSaveState/.test(source), 'Product settings Save-state detector is missing.');
assert(/initialState\.found && initialState\.selected === true/.test(source), 'Already-selected Full front path is missing.');
assert(/already-selected-back/.test(source), 'Already-selected Full front recovery must remain available for disabled/no-op Save states.');
assert(/lastSaveState\.found && lastSaveState\.disabled/.test(source), 'Disabled Save recovery is missing.');
assert(/disabled-save-already-full-front/.test(source), 'Disabled Save + selected Full front success path is missing.');
assert(/waitForDesignProductsFullFront/.test(source), 'Design products Full front verification is missing.');
assert(/Save was clicked, but Full front was not confirmed/.test(source), 'Save click must be verified against the Design products summary.');
assert(/originalWaitForProductsCreated\(page, 45000\)/.test(source), 'Placement changes must still wait for product regeneration.');

assert(/previousWaitForProductsCreated/.test(recovery), 'Product-settings recovery must wrap the proven placement flow rather than replace it.');
assert(/visibleProductSettings/.test(recovery), 'Recovery must explicitly detect the visible Product settings page.');
assert(/fullFront\.found && fullFront\.selected === true/.test(recovery), 'Recovery must verify Full front is selected before leaving Product settings.');
assert(/save && !save\.disabled/.test(recovery), 'Enabled Product settings Save path is missing.');
assert(/save\.locator\.click/.test(recovery), 'Recovery must click the real visible Save control.');
assert(/waitUntilBackInEditor/.test(recovery), 'Recovery must wait until Product settings is gone and Design products is visible.');
assert(/waitForProductRegeneration/.test(recovery), 'Recovery must allow product settings to settle before metadata/publish continues.');
assert(/save\?\.disabled|save\.disabled/.test(recovery), 'Disabled Save fallback is missing.');

const recordedIndex = bootstrap.indexOf("require('./spreadshirtRecordedPlacementPatch')");
const recoveryIndex = bootstrap.indexOf("require('./spreadshirtProductSettingsSaveRecoveryPatch')");
const cardIndex = bootstrap.indexOf("require('./spreadshirtCardDetectionPatch')");
const freshIndex = bootstrap.indexOf("require('./spreadshirtFreshUploadIdentityPatch')");
assert(recordedIndex >= 0 && recoveryIndex > recordedIndex, 'Product settings Save recovery must load after the recorded Full front placement layer.');
assert(cardIndex > recoveryIndex && freshIndex > recoveryIndex, 'Card/fresh upload layers must capture the recovered waitForProductsCreated implementation.');

console.log('Spreadshirt Full front + Product settings Save transition smoke checks passed.');
