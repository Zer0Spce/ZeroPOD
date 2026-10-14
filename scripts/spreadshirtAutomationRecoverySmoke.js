const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

const recovery = read('src/main/spreadshirtAutomationUploadRecoveryPatch.js');
const attention = read('src/main/automationSpreadshirtAttentionPatch.js');
const hidden = read('src/main/spreadshirtPublishBrowserDebugPatch.js');

assert(/POST_UPLOAD_CARD_ERROR/.test(recovery), 'Post-upload card verification recovery trigger is missing.');
assert(/automationTargets\?\.spreadshirt/.test(recovery) || /automationTargets\?\.spreadshirt === true/.test(recovery), 'Recovery must be scoped to Automation Spreadshirt projects.');
assert(/perceptualFingerprint/.test(recovery) && /visualHash/.test(recovery), 'Recovery must match the actual uploaded artwork visually.');
assert(/entry\.index >= 0 && entry\.index <= 2/.test(recovery), 'Recovery must restrict visual matching to newest cards.');
assert(/uploadAcceptedAt/.test(recovery) && /automationRecoveredUploadAt/.test(recovery), 'Recovered upload must be recorded before prepare resumes.');
assert(/automationUploadRecoveryError/.test(recovery), 'Recovery must survive a manual Automation Retry.');
assert(/automationUploadRecoveryError:\s*needsUploadRecovery \? previousError : null/.test(attention), 'Retry must preserve post-upload recovery evidence without leaving the row latched.');
assert(/require\('\.\/spreadshirtAutomationUploadRecoveryPatch'\)/.test(hidden), 'Recovery wrapper must load before the hidden-browser prepare wrapper captures feature.prepare.');

console.log('Spreadshirt Automation post-upload recovery smoke passed.');
