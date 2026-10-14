const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'src', 'main', 'bootstrap.js'), 'utf8');
const action = fs.readFileSync(path.join(root, 'src', 'main', 'spreadshirtSavePublishActionPatch.js'), 'utf8');
const identity = fs.readFileSync(path.join(root, 'src', 'main', 'spreadshirtCanonicalDesignIdentityPatch.js'), 'utf8');

function must(condition, message) {
  if (!condition) throw new Error(message);
}

const strictIndex = bootstrap.indexOf("require('./spreadshirtStrictPublishVerifyPatch')");
const actionIndex = bootstrap.indexOf("require('./spreadshirtSavePublishActionPatch')");
const forbiddenIndex = bootstrap.indexOf("require('./spreadshirtForbiddenMetadataRepairPatch')");
const identityIndex = bootstrap.indexOf("require('./spreadshirtCanonicalDesignIdentityPatch')");
const proofIndex = bootstrap.indexOf("require('./spreadshirtExactGridPublishProofPatch')");

must(strictIndex >= 0 && actionIndex > strictIndex, 'Save/publish action guard must load after strict verifier.');
must(forbiddenIndex > actionIndex, 'Forbidden metadata repair must wrap the action guard so cleanup happens before clicking.');
must(identityIndex > forbiddenIndex, 'Canonical identity guard must wrap forbidden metadata repair.');
must(proofIndex > identityIndex, 'Exact-grid proof must remain the final publish verifier.');

must(/Visible “Save and publish” is still actionable/.test(action), 'Action guard must refuse status-only shortcut while Save and publish is actionable.');
must(/clickSaveAndPublishTrusted/.test(action), 'Action guard must physically click the trusted Save and publish control.');
must(/publishActionClickedAt/.test(action), 'Action guard must record the click timestamp.');
must(/uploadDesignId/.test(identity), 'Identity guard must bind publish to uploadDesignId.');
must(/preUploadDesignIds/.test(identity), 'Identity correction must protect pre-upload design IDs.');
must(/editor name/.test(identity), 'Identity guard must compare the live editor metadata title.');

console.log('Spreadshirt Save-and-publish action smoke checks passed.');
