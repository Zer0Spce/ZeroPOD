const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtFinalApprovalSequencePatch.js');
const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Final approval patch syntax failed.');

const source = fs.readFileSync(file, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/clickEditorNavigation\(page, 'Products'\)/.test(source), 'Final approval must explicitly open Products first.');
assert(/ensureFullFrontPlacement/.test(source), 'Final approval must enforce Standard placement Full front.');
assert(/Change settings → Standard placement → Full front/.test(source), 'Final approval must document the confirmed Change settings sequence.');
assert(/clickEditorNavigation\(page, 'Metadata'\)/.test(source), 'Final approval must return to Metadata after placement.');
assert(/ensurePublishSwitchOn/.test(source), 'Final approval must handle Publish on Spreadshirt after placement.');
assert(/enableMarketplaceCustomToggle\(page\)/.test(source), 'Final approval must use the trusted shared marketplace-switch activator.');
assert(/real browser mouse/i.test(source), 'Final approval must use a real browser mouse for the marketplace switch.');
assert(/checked === true/.test(source), 'Final approval must not toggle an already-ON marketplace switch off.');
assert(/\^Save and publish\$/.test(source), 'Final approval must wait for the exact Save and publish action.');
assert(/Design status\\s\*In review/.test(source), 'In review design status must count as published success.');
assert(/verifyMarketplacePublished/.test(source), 'Marketplace Published verification must remain as a safety fallback.');

const order = [
  source.indexOf("clickEditorNavigation(page, 'Products')"),
  source.indexOf('ensureFullFrontPlacement(page)'),
  source.indexOf("clickEditorNavigation(page, 'Metadata')"),
  source.indexOf('ensurePublishSwitchOn(page, projectId)'),
  source.indexOf('clickSaveAndPublish(page, 15000)')
];
assert(order.every((value) => value >= 0), 'Final approval sequence components are missing.');
assert(order.every((value, index) => index === 0 || value > order[index - 1]), 'Final approval order must be Products -> Full front -> Metadata -> Publish switch -> Save and publish.');

console.log('Spreadshirt exact Products -> Full front -> Metadata -> trusted Publish switch -> Save and publish smoke checks passed.');
