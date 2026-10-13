const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = [
  'src/main/spreadshirtMarketplaceRoutePatch.js',
  'src/main/spreadshirtEditorResumePatch.js',
  'src/main/bootstrap.js'
];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file} syntax failed: ${result.stderr || result.stdout}`);
}

const route = fs.readFileSync(path.join(root, 'src/main/spreadshirtMarketplaceRoutePatch.js'), 'utf8');
const resume = fs.readFileSync(path.join(root, 'src/main/spreadshirtEditorResumePatch.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'src/main/bootstrap.js'), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/MARKETPLACE_DESIGNS_RE = \/\\\/mp\\\/designs\\\/?\(\?:\[\?#\]\.\*\)\?\$\/i/.test(route), 'Marketplace Designs dashboard regex must be exact and must not match design-editor child paths.');
assert(/MARKETPLACE_DESIGN_EDITOR_RE/.test(route), 'Marketplace design-editor route detector is missing.');
assert(/isMarketplaceDesignsIndexUrl/.test(route), 'Marketplace Designs exact-index helper is missing.');
assert(/isMarketplaceDesignEditorUrl/.test(route), 'Marketplace design-editor helper is missing.');
assert(/looksLikeDesignEditor/.test(resume), 'Spreadshirt editor recovery detector is missing.');
assert(/design editor is already open/i.test(resume), 'Spreadshirt editor recovery Activity message is missing.');
assert(/waitForDesignEditor/.test(resume) && /waitForProductsCreated/.test(resume), 'Spreadshirt editor recovery must continue through the existing design editor.');
assert(/fillMetadata/.test(resume), 'Spreadshirt editor recovery must continue to metadata instead of returning to Designs.');

const toggleIndex = bootstrap.indexOf("require('./spreadshirtMarketplaceTogglePatch')");
const resumeIndex = bootstrap.indexOf("require('./spreadshirtEditorResumePatch')");
const finalPublishIndex = bootstrap.indexOf("require('./spreadshirtFinalPublishPatch')");
assert(toggleIndex >= 0 && resumeIndex > toggleIndex && finalPublishIndex > resumeIndex, 'Spreadshirt editor-resume patch must load after prepare/toggle patches and before final-publish patches.');

console.log('Spreadshirt exact dashboard-vs-editor routing and editor-resume smoke checks passed.');
