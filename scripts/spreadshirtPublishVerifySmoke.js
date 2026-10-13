const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const legacyFile = path.join(root, 'src/main/spreadshirtFinalPublishPatch.js');
const strictFile = path.join(root, 'src/main/spreadshirtStrictPublishVerifyPatch.js');
const legacy = fs.readFileSync(legacyFile, 'utf8');
const strict = fs.readFileSync(strictFile, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const file of [legacyFile, strictFile]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert(syntax.status === 0, syntax.stderr || syntax.stdout || `${path.basename(file)} failed syntax check`);
}

assert(/allFramesText/.test(legacy) && /page\.frames\(\)/.test(legacy), 'Spreadshirt final publish confirmation must inspect all frames.');
assert(/verifyMarketplacePublished/.test(legacy), 'Spreadshirt Marketplace publish verification is missing.');
assert(/MARKETPLACE_DESIGNS_URL/.test(legacy), 'Spreadshirt publish verification must use Marketplace Designs.');
assert(/filterMarketplaceByTitle/.test(legacy) && /firstMarketplaceCard/.test(legacy), 'Legacy Spreadshirt publish verification fallback must remain available.');
assert(/context\.newPage\(\)/.test(legacy), 'Spreadshirt publish verification must preserve the prepared editor with a separate verification page.');
assert(/actionNumber <= 2/.test(legacy), 'Spreadshirt final publish retries must remain bounded.');

assert(/designIdFromEditorUrl/.test(strict), 'Strict publish verification must derive the unique Spreadshirt design ID from the editor URL.');
assert(/readEditorPublishStatus/.test(strict), 'Strict publish verification must read Design status from the exact design editor.');
assert(/Sell your products on the Spreadshirt marketplace/.test(strict) && /Design status/.test(strict), 'Exact editor verification must anchor on the Publish on Spreadshirt status card.');
assert(/verifyPage\.goto\(editorUrl/.test(strict), 'Strict verification must open the exact saved design editor URL before using dashboard fallbacks.');
assert(/readMarketplaceCardByDesignId/.test(strict), 'Strict verification must support exact design-ID DOM lookup on Marketplace Designs.');
assert(/attrContainsId/.test(strict) && /data-design-id/.test(strict), 'Marketplace fallback must inspect href/data/id attributes for the exact design ID.');
assert(/single-card-after-exact-id-search/.test(strict), 'Search-box card count must be only a final single-card fallback.');
assert(/exact-design-id-dom-not-found-search-returned-/.test(strict), 'Multiple search results must remain unverified rather than causing a false publish.');
assert(/strict\.verified && strict\.published/.test(strict), 'Only verified exact-design status may mark Spreadshirt Published.');
assert(/strict\.verified && strict\.draft/.test(strict), 'Exact Draft status must remain distinguishable and block publish success.');
assert(/removePublishLedgerEntry/.test(strict) && /restoreFalsePublishedProject/.test(strict), 'Strict verification must repair false local Published state and ledger counts.');
assert(/publishVerificationSource/.test(strict), 'Strict publish records must retain the verification source for diagnostics.');
assert(/Clicked Spreadshirt “Save and publish”\. Waiting for this exact design editor/.test(strict), 'Final publish must wait on this exact design, not generic published text.');

console.log('Spreadshirt strict exact-editor/design-ID publish verification smoke checks passed.');
