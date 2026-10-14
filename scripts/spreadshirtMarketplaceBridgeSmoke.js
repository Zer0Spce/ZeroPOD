const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const bridgeFile = path.join(root, 'src/main/spreadshirtMarketplaceToggleBridgePatch.js');
const bootstrapFile = path.join(root, 'src/main/bootstrap.js');
const postVerifyFile = path.join(root, 'src/main/spreadshirtPostUploadCardVerifyPatch.js');

const syntax = spawnSync(process.execPath, ['--check', bridgeFile], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Marketplace toggle bridge syntax failed.');

const bridge = fs.readFileSync(bridgeFile, 'utf8');
const bootstrap = fs.readFileSync(bootstrapFile, 'utf8');
const postVerify = fs.readFileSync(postVerifyFile, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/enableMarketplaceCustomToggle/.test(bridge), 'Bridge must reuse the tested visible/native marketplace toggle implementation.');
assert(/videoFlow\.enableSpreadshirtMarketplace\s*=\s*enableSpreadshirtMarketplaceBridged/.test(bridge), 'Bridge must replace the old hidden-checkbox helper export.');
assert(/return Boolean\(result\?\.ok\)/.test(bridge), 'Bridge must return a simple verified enabled state to the final prepare flow.');

const toggleIndex = bootstrap.indexOf("require('./spreadshirtMarketplaceTogglePatch')");
const bridgeIndex = bootstrap.indexOf("require('./spreadshirtMarketplaceToggleBridgePatch')");
const postIndex = bootstrap.indexOf("require('./spreadshirtPostUploadCardVerifyPatch')");
assert(toggleIndex >= 0 && bridgeIndex > toggleIndex, 'Bridge must load after the marketplace toggle implementation.');
assert(postIndex > bridgeIndex, 'Bridge must load before post-upload prepare imports enableSpreadshirtMarketplace.');
assert(/enableSpreadshirtMarketplace/.test(postVerify), 'Final post-upload prepare must continue importing the bridged helper from video flow.');

console.log('Spreadshirt marketplace hidden-checkbox bridge smoke checks passed.');
