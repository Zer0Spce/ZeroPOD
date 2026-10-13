const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const file of [
  'src/main/spreadshirtRecordedPlacementPatch.js',
  'src/main/spreadshirtRecordedPublishPatch.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file} failed syntax check: ${result.stderr || result.stdout}`);
}

const placement = read('src/main/spreadshirtRecordedPlacementPatch.js');
const publish = read('src/main/spreadshirtRecordedPublishPatch.js');
const bootstrap = read('src/main/bootstrap.js');

assert(/Change settings/i.test(placement), 'Recorded placement flow must open Change settings.');
assert(/Full front/i.test(placement), 'Recorded placement flow must select Full front.');
assert(/Product settings/i.test(placement), 'Recorded placement flow must verify Product settings.');
assert(/originalWaitForProductsCreated\(page, 45000\)/.test(placement), 'Placement flow must wait for the second product-generation pass with the original helper.');
assert(!/videoFlow\.waitForProductsCreated\(page, 45000\)/.test(placement), 'Placement flow must not recurse through the patched product waiter.');
assert(/videoFlow\.waitForProductsCreated = async function waitForProductsCreatedWithFullFront/.test(placement), 'Full front placement must be enforced before metadata/final review.');

assert(/Your design has been published, but is still under review/i.test(publish), 'Exact Spreadshirt under-review publish banner must count as success.');
assert(/ensureFullFrontPlacement/.test(publish), 'Existing prepared projects must enforce Full front before publish.');
assert(/enableMarketplaceCustomToggle/.test(publish), 'Recorded publish flow must explicitly enable Publish on Spreadshirt.');
assert(/\^Save and publish\$/.test(publish), 'Recorded publish flow must require the exact Save and publish action.');
assert(!/\^Save\$/.test(publish), 'Recorded final publish must never fall back to plain Save.');
assert(/reviewState: options\.underReview \? 'under-review'/.test(publish), 'Under-review publication must be persisted as a successful published state.');
assert(/verifyMarketplacePublished/.test(publish), 'Recorded publish flow must keep Marketplace status verification as a safety fallback.');

const alphaIpc = bootstrap.indexOf("require('./spreadshirtAlphaIpc')");
const placementPatch = bootstrap.indexOf("require('./spreadshirtRecordedPlacementPatch')");
const cardPatch = bootstrap.indexOf("require('./spreadshirtCardDetectionPatch')");
const togglePatch = bootstrap.indexOf("require('./spreadshirtMarketplaceTogglePatch')");
const finalPatch = bootstrap.indexOf("require('./spreadshirtFinalPublishPatch')");
const recordedPublish = bootstrap.indexOf("require('./spreadshirtRecordedPublishPatch')");
const uiPatch = bootstrap.indexOf("require('./spreadshirtAlphaUiPatch')");
assert(alphaIpc >= 0 && alphaIpc < placementPatch && placementPatch < cardPatch, 'Recorded Full front patch must load after Spreadshirt IPC and before card recovery imports the product waiter.');
assert(cardPatch < togglePatch && togglePatch < finalPatch && finalPatch < recordedPublish && recordedPublish < uiPatch, 'Recorded final publish patch must be the last Spreadshirt publish override before UI/main.');

console.log('Spreadshirt recorded-video Full front + Save and publish smoke checks passed.');
