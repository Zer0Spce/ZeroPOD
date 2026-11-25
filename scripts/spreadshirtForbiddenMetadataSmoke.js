const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const patchFile = path.join(root, 'src/main/spreadshirtForbiddenMetadataRepairPatch.js');
const source = fs.readFileSync(patchFile, 'utf8');
const syntax = spawnSync(process.execPath, ['--check', patchFile], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Forbidden metadata patch syntax failed.');

const assert = (value, message) => { if (!value) throw new Error(message); };
assert(/The following terms are not allowed/.test(source), 'Must detect Spreadshirt forbidden-term validation.');
assert(/repairForbiddenMetadata/.test(source), 'Must repair forbidden metadata before publish.');
assert(/removeForbiddenTagChip/.test(source), 'Must remove forbidden tag chips.');
assert(/description\.fill\(next\)/.test(source), 'Must remove forbidden terms from the description field.');
assert(/rollbackFalsePublishedState/.test(source), 'Must revert false local Published state if validation remains.');
assert(/previousPublish\(projectId\)/.test(source), 'Must keep the existing strict publish flow after cleanup.');
assert(/without re-uploading|did not upload another design/.test(source), 'Repair path must preserve the existing upload.');
console.log('Spreadshirt forbidden metadata repair smoke checks passed.');
