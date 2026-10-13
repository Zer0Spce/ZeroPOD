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
assert(/marketplaceState/.test(publish), 'Recorded publish flow must read the actual marketplace switch state.');
assert(/waitForMarketplacePublishingEnabled/.test(publish), 'Recorded publish flow must positively verify marketplace publishing is ON.');
assert(/\^Save and publish\$/.test(publish), 'Recorded publish flow must still prefer the exact Save and publish action.');
assert(/clickVerifiedEditorSave/.test(publish), 'Current Spreadshirt editor must support the verified plain Save publish fallback.');
assert(/\^Save\$/i.test(publish), 'Verified publish fallback must target only an exact plain Save action.');
assert(/!state\.verified \|\| !state\.enabled/.test(publish), 'Plain Save fallback must be blocked unless marketplace publishing is positively verified ON.');
assert(/Marketplace publishing is confirmed ON/.test(publish), 'Activity log must show that marketplace publishing was verified before final Save.');
assert(/verified-marketplace-save/.test(publish), 'Plain Save fallback must be explicitly marked as marketplace-verified.');
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

console.log('Spreadshirt recorded-video Full front + verified marketplace Save publish smoke checks passed.');
