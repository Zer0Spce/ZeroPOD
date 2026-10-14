const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const reliabilityFile = path.join(root, 'src/main/spreadshirtCreateNewReliabilityPatch.js');
const menuFile = path.join(root, 'src/main/spreadshirtCreateNewMenuPatch.js');
const bootstrapFile = path.join(root, 'src/main/bootstrap.js');
const postVerifyFile = path.join(root, 'src/main/spreadshirtPostUploadCardVerifyPatch.js');

for (const file of [reliabilityFile, menuFile]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || `${path.basename(file)} syntax failed.`);
}

const reliability = fs.readFileSync(reliabilityFile, 'utf8');
const menu = fs.readFileSync(menuFile, 'utf8');
const bootstrap = fs.readFileSync(bootstrapFile, 'utf8');
const postVerify = fs.readFileSync(postVerifyFile, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/waitForUploadResultFromVisibleState/.test(reliability), 'Visible Upload Status verification must remain active.');
assert(/sawVisibleUploadStatus/.test(reliability), 'Upload verification must track a visible Upload Status modal.');
assert(/visible-status-closed-needs-card-verification/.test(reliability), 'Card verification must still require a real visible upload-status handoff.');

assert(/openCreateNewThenUploadDesign/.test(menu), 'Create New menu compatibility helper must exist.');
assert(/findVisibleUploadDesignAction/.test(menu), 'Create New flow must detect the intermediate Upload Design action.');
assert(/waitForCreateNewOutcome/.test(menu), 'Create New flow must inspect the first click result before retrying.');
assert(/upload\\s\+designs\?/.test(menu), 'Upload Design detection must allow current singular/plural menu wording.');
assert(/candidate\.click\(\{ force: true, timeout: 3000 \}\)/.test(menu), 'Create New must restore yesterday\'s known-working forced Playwright click first.');
assert(/another Create New click would simply close it/.test(menu), 'Create New flow must explicitly protect the intermediate menu from being toggled closed.');
assert(/clickUploadDesignAction/.test(menu), 'Intermediate Upload Design choice must be clicked before file selection.');
assert(/selectFileFromCurrentUploadSurface/.test(menu), 'File selection must target the current visible upload surface.');
assert(/No stale page-level file input was used/.test(menu), 'File selection must refuse stale hidden controls.');
assert(/videoFlow\.openCreateNewDialog = openCreateNewThenUploadDesign/.test(menu), 'Menu-aware Create New helper must be the final exported open helper.');
assert(/videoFlow\.selectFileLikeVideo = selectFileFromCurrentUploadSurface/.test(menu), 'Menu-aware file selector must be the final exported file helper.');

const transitionIndex = bootstrap.indexOf("require('./spreadshirtUploadTransitionPatch')");
const reliabilityIndex = bootstrap.indexOf("require('./spreadshirtCreateNewReliabilityPatch')");
const menuIndex = bootstrap.indexOf("require('./spreadshirtCreateNewMenuPatch')");
const postIndex = bootstrap.indexOf("require('./spreadshirtPostUploadCardVerifyPatch')");
assert(transitionIndex >= 0 && reliabilityIndex > transitionIndex, 'Visible-state reliability must load after the older transition patch.');
assert(menuIndex > reliabilityIndex, 'Create New menu compatibility must load after the strict visible-state layer so it can override only entry/file selection.');
assert(postIndex > menuIndex, 'Create New menu compatibility must load before post-upload prepare imports the final helpers.');
assert(/openCreateNewDialog/.test(postVerify) && /selectFileLikeVideo/.test(postVerify) && /waitForUploadResult/.test(postVerify), 'Post-upload prepare must consume the final overridden helpers.');

console.log('Spreadshirt Create New -> Upload Design menu -> visible upload surface -> file select -> visible Upload Status smoke checks passed.');
