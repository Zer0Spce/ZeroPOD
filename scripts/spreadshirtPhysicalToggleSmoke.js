const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtMarketplaceTogglePatch.js');
const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Marketplace toggle patch syntax failed.');

const source = fs.readFileSync(file, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/physical-right-toggle/.test(source), 'Spreadshirt marketplace toggle must have a physical right-side switch click path.');
assert(/document\.elementFromPoint/.test(source), 'Spreadshirt physical toggle must hit-test the visible switch by screen geometry.');
assert(/containerRect\.width \* 0\.58/.test(source), 'Spreadshirt physical toggle must constrain targeting to the right side of the Publish card.');
assert(/rect\.width >= 38 && rect\.width <= 130/.test(source), 'Spreadshirt physical toggle must constrain candidates to switch-sized controls.');
assert(/statusTop/.test(source), 'Spreadshirt physical toggle must stay above the Design status row.');
assert(/saveAndPublishVisible/.test(source), 'Save and publish visibility must be usable as a positive ON-state signal.');
assert(/toggle-did-not-turn-on/.test(source), 'An unverified physical click must fail instead of pretending the switch is ON.');
assert(!/visible-control-unverified/.test(source), 'Old unverified toggle success fallback must not return.');

console.log('Spreadshirt physical right-side marketplace-toggle smoke checks passed.');
