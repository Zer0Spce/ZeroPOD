const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtFinalApprovalSequencePatch.js');
const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Final approval patch syntax failed.');

const source = fs.readFileSync(file, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/ensurePublishSwitchOn/.test(source), 'Final approval must explicitly handle Publish on Spreadshirt first.');
assert(/Clicking Publish on Spreadshirt first/.test(source), 'Final approval must log the required switch-first interaction.');
assert(/checked === true/.test(source), 'Final approval must avoid toggling an already-ON marketplace switch off.');
assert(/\^Save and publish\$/.test(source), 'Final approval must wait for the exact Save and publish action after the switch.');
assert(/Design status\\s\*In review/.test(source), 'In review design status must count as published success.');
assert(!/ensureFullFrontPlacement/.test(source), 'Final publish must never reopen Product settings/Full front placement.');
assert(!/Change settings/.test(source), 'Final publish must not depend on Change settings.');
assert(/verifyMarketplacePublished/.test(source), 'Marketplace Published verification must remain as a safety fallback.');

console.log('Spreadshirt final approval switch-first smoke checks passed.');
