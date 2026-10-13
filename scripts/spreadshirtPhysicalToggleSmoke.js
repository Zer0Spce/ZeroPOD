const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtMarketplaceTogglePatch.js');
const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Marketplace toggle patch syntax failed.');

const source = fs.readFileSync(file, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/playwright-native-mouse/.test(source), 'Spreadshirt marketplace toggle must retain the trusted browser-mouse path.');
assert(/playwright-checkbox-wrapper-mouse/.test(source), 'Spreadshirt marketplace toggle must prefer a real mouse click on the checkbox-linked visible wrapper.');
assert(/page\.mouse\.move/.test(source) && /page\.mouse\.down/.test(source) && /page\.mouse\.up/.test(source), 'Spreadshirt physical switch must use real Playwright mouse input.');
assert(/pagePointForFrameRect/.test(source), 'Spreadshirt physical switch must translate frame-local geometry to page coordinates.');
assert(/checkbox\?\.closest|checkbox\.closest/.test(source), 'Spreadshirt switch targeting must derive from the actual hidden checkbox DOM relationship.');
assert(/checkboxLinkedTargetRect/.test(source), 'Spreadshirt switch state must expose the checkbox-linked visible target geometry.');
assert(/checkbox\.click\(\)/.test(source), 'Hidden Spreadshirt checkbox must have native browser activation as a fallback.');
assert(/checkbox-native-click/.test(source), 'Native checkbox activation must be reported for diagnostics.');
assert(/waitForMarketplaceEnabled/.test(source), 'Every switch activation attempt must verify checked state or Save and publish.');
assert(/sell your products on the spreadshirt marketplace/.test(source), 'Spreadshirt physical toggle must anchor on the actual Marketplace card instead of the top navigation action.');
assert(/saveAndPublishVisibleAnywhere/.test(source), 'Save and publish visibility must remain usable as a positive ON-state signal.');
assert(/toggle-did-not-turn-on/.test(source), 'An unverified switch activation must fail instead of pretending the switch is ON.');
assert(/Final Review will continue/.test(source), 'Prepare must not be blocked when metadata is ready but the marketplace switch remains OFF.');
assert(/marketplaceSwitchPrepared/.test(source), 'Prepare must persist whether marketplace activation succeeded without blocking Final Review.');
assert(!/visible-control-unverified/.test(source), 'Old unverified toggle success fallback must not return.');

console.log('Spreadshirt exact checkbox-wrapper + trusted mouse + native checkbox activation smoke checks passed.');
