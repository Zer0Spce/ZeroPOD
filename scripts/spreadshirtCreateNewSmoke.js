const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const patchFile = path.join(root, 'src/main/spreadshirtCreateNewReliabilityPatch.js');
const bootstrapFile = path.join(root, 'src/main/bootstrap.js');
const postVerifyFile = path.join(root, 'src/main/spreadshirtPostUploadCardVerifyPatch.js');

const syntax = spawnSync(process.execPath, ['--check', patchFile], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Create New reliability patch syntax failed.');

const patch = fs.readFileSync(patchFile, 'utf8');
const bootstrap = fs.readFileSync(bootstrapFile, 'utf8');
const postVerify = fs.readFileSync(postVerifyFile, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/openCreateNewDialogReliable/.test(patch), 'Reliable Create New helper must exist.');
assert(/visibleUploadDesignDialog/.test(patch) && /waitForVisibleUploadDesignDialog/.test(patch), 'Create New must verify a visible Upload Design dialog.');
assert(/candidate\.click\(\{ timeout: 3000 \}\)/.test(patch), 'Create New must prefer a normal trusted Playwright click.');
assert(/page\.mouse\.click/.test(patch), 'Create New must retain a coordinate-click fallback.');
assert(/refused to use hidden\/stale file controls/.test(patch), 'File selection must refuse stale hidden page controls.');
assert(/dialog\.locator\('input\[type="file"\]'\)/.test(patch), 'File input must be scoped to the visible upload dialog.');
assert(/sawVisibleUploadStatus/.test(patch), 'Upload verification must track a visible Upload Status modal.');
assert(/visible-status-closed-needs-card-verification/.test(patch), 'Card verification handoff must require a visible status modal first.');
assert(/never showed a VISIBLE “Upload Status”/.test(patch), 'Missing upload status must fail at the upload step instead of the card step.');
assert(/videoFlow\.openCreateNewDialog = openCreateNewDialogReliable/.test(patch), 'Reliable Create New must override the video helper export.');
assert(/videoFlow\.selectFileLikeVideo = selectFileFromVisibleDialog/.test(patch), 'Visible-dialog file selection must override the video helper export.');
assert(/videoFlow\.waitForUploadResult = waitForUploadResultFromVisibleState/.test(patch), 'Visible upload status verification must be the final exported wait helper.');

const transitionIndex = bootstrap.indexOf("require('./spreadshirtUploadTransitionPatch')");
const createIndex = bootstrap.indexOf("require('./spreadshirtCreateNewReliabilityPatch')");
const postIndex = bootstrap.indexOf("require('./spreadshirtPostUploadCardVerifyPatch')");
assert(transitionIndex >= 0 && createIndex > transitionIndex, 'Create New reliability must load after the older upload-transition patch.');
assert(postIndex > createIndex, 'Create New reliability must load before post-upload prepare imports the helpers.');
assert(/openCreateNewDialog/.test(postVerify) && /selectFileLikeVideo/.test(postVerify) && /waitForUploadResult/.test(postVerify), 'Post-upload prepare must consume the overridden video-flow helpers.');

console.log('Spreadshirt visible Create New -> Upload Design -> file select -> Upload Status smoke checks passed.');
