const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const patchFile = path.join(root, 'src/main/spreadshirtNoStatusCardHandoffPatch.js');
const bootstrapFile = path.join(root, 'src/main/bootstrap.js');
const postVerifyFile = path.join(root, 'src/main/spreadshirtPostUploadCardVerifyPatch.js');

const syntax = spawnSync(process.execPath, ['--check', patchFile], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'No-status card handoff patch syntax failed.');

const patch = fs.readFileSync(patchFile, 'utf8');
const bootstrap = fs.readFileSync(bootstrapFile, 'utf8');
const postVerify = fs.readFileSync(postVerifyFile, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/waitForUploadResultAllowNoStatusCardHandoff/.test(patch), 'No-status upload handoff helper must exist.');
assert(/waitForUploadResultFromVisibleState/.test(patch), 'No-status handoff must wrap the verified visible upload-state helper.');
assert(/never showed a VISIBLE/.test(patch), 'No-status handoff must only catch the exact missing-visible-status failure.');
assert(/DESIGNS_INDEX_RE/.test(patch), 'No-status handoff must require the Marketplace Designs index.');
assert(/needsCardVerification:\s*true/.test(patch), 'No-status handoff must defer to fresh-card verification rather than recording success.');
assert(/confirmed:\s*false/.test(patch), 'No-status handoff must not mark the upload directly confirmed.');
assert(/sawUploadStatus:\s*false/.test(patch), 'No-status handoff must accurately record that no visible status was seen.');
assert(/videoFlow\.waitForUploadResult\s*=\s*waitForUploadResultAllowNoStatusCardHandoff/.test(patch), 'No-status handoff must become the final upload-result helper.');

const menuIndex = bootstrap.indexOf("require('./spreadshirtCreateNewMenuPatch')");
const noStatusIndex = bootstrap.indexOf("require('./spreadshirtNoStatusCardHandoffPatch')");
const postIndex = bootstrap.indexOf("require('./spreadshirtPostUploadCardVerifyPatch')");
assert(menuIndex >= 0 && noStatusIndex > menuIndex, 'No-status handoff must load after the working Create New/menu patch.');
assert(postIndex > noStatusIndex, 'No-status handoff must load before post-upload prepare imports waitForUploadResult.');
assert(/waitForVerifiedNewCard/.test(postVerify) && /needsCardVerification/.test(postVerify), 'Post-upload flow must still require genuinely-new-card verification for ambiguous uploads.');
assert(/markUploadAccepted/.test(postVerify), 'Upload acceptance must remain owned by the verified card layer.');

console.log('Spreadshirt verified file-selection -> no visible status -> fresh-card handoff smoke checks passed.');
