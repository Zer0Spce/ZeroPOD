const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtFinalApprovalSequencePatch.js');
const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'Final approval sequence syntax failed.');

const source = fs.readFileSync(file, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/restoreDesignEditorForPublish/.test(source), 'Final publish must restore the design editor before opening Products.');
assert(/project\.spreadshirt\.editorUrl/.test(source), 'Final publish must prefer the saved editor URL.');
assert(/waitForDesignEditor/.test(source), 'Final publish must wait for the editor shell to render.');
assert(/verifyExpectedDraftExists/.test(source), 'Final publish must recover an existing Draft if the saved editor URL is stale.');
assert(/clickMarketplaceCard/.test(source), 'Final publish Draft recovery must reopen the existing card without re-uploading.');
assert(/No artwork was re-uploaded/.test(source), 'Final publish recovery must explicitly preserve the existing upload.');

const restoreIndex = source.indexOf('await restoreDesignEditorForPublish(page, projectId, project)');
const productsIndex = source.indexOf('await openProductsAndSetFullFront(page, projectId)');
assert(restoreIndex >= 0 && productsIndex > restoreIndex, 'Editor restore must happen before Products / Full front.');

console.log('Spreadshirt final-publish editor restore/recovery smoke checks passed.');
