const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtMarketplaceTogglePatch.js');
const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Spreadshirt marketplace toggle syntax failed.');

const source = fs.readFileSync(file, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/checkbox\.closest\(/.test(source), 'Switch targeting must derive from the actual Spreadshirt checkbox DOM.');
assert(/checkbox\.click\(\)/.test(source), 'Hidden Spreadshirt checkbox must have a native browser activation fallback.');
assert(/checkbox-native-click/.test(source), 'Native checkbox activation method must be reported for diagnostics.');
assert(/waitForMarketplaceEnabled/.test(source), 'Marketplace toggle must verify checked state or Save and publish after each activation attempt.');
assert(/playwright-checkbox-wrapper-mouse/.test(source), 'Primary switch activation must use a real browser mouse on the checkbox-linked visible wrapper.');
assert(/toggle-did-not-turn-on/.test(source), 'Toggle failure diagnostics must remain explicit.');

console.log('Spreadshirt exact checkbox-wrapper + native activation smoke checks passed.');
