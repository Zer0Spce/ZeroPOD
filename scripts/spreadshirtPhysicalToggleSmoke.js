const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtMarketplaceTogglePatch.js');
const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Marketplace toggle patch syntax failed.');

const source = fs.readFileSync(file, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/playwright-native-mouse/.test(source), 'Spreadshirt marketplace toggle must use the trusted browser-mouse path.');
assert(/page\.mouse\.move/.test(source) && /page\.mouse\.down/.test(source) && /page\.mouse\.up/.test(source), 'Spreadshirt physical switch must use real Playwright mouse input.');
assert(/pagePointForFrameRect/.test(source), 'Spreadshirt physical switch must translate frame-local geometry to page coordinates.');
assert(/containerRect\.width \* 0\.58/.test(source), 'Spreadshirt physical toggle must constrain targeting to the right side of the Publish card.');
assert(/aspect >= 1\.25/.test(source), 'Spreadshirt physical toggle must prefer track-shaped controls instead of the round knob.');
assert(/sell your products on the spreadshirt marketplace/.test(source), 'Spreadshirt physical toggle must anchor on the actual Marketplace card instead of the top navigation action.');
assert(/saveAndPublishVisibleAnywhere/.test(source), 'Save and publish visibility must be usable as a positive ON-state signal.');
assert(/toggle-did-not-turn-on/.test(source), 'An unverified physical click must fail instead of pretending the switch is ON.');
assert(/Final Review will continue/.test(source), 'Prepare must not be blocked when metadata is ready but the marketplace switch remains OFF.');
assert(/marketplaceSwitchPrepared/.test(source), 'Prepare must persist whether marketplace activation succeeded without blocking Final Review.');
assert(!/visible-control-unverified/.test(source), 'Old unverified toggle success fallback must not return.');

console.log('Spreadshirt trusted physical marketplace-toggle + non-blocking Prepare smoke checks passed.');
