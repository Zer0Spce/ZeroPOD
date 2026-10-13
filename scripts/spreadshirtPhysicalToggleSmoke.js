const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const toggleFile = path.join(root, 'src/main/spreadshirtMarketplaceTogglePatch.js');
const strictFile = path.join(root, 'src/main/spreadshirtStrictPublishVerifyPatch.js');
const debugFile = path.join(root, 'src/main/spreadshirtPublishBrowserDebugPatch.js');
for (const file of [toggleFile, strictFile, debugFile]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || `${path.basename(file)} syntax failed.`);
}

const source = fs.readFileSync(toggleFile, 'utf8');
const strict = fs.readFileSync(strictFile, 'utf8');
const debug = fs.readFileSync(debugFile, 'utf8');
const dock = fs.readFileSync(path.join(root, 'src/main/chromeDockPatch.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'src/main/bootstrap.js'), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/playwright-native-mouse/.test(source), 'Spreadshirt marketplace toggle must retain the trusted browser-mouse path.');
assert(/playwright-checkbox-wrapper-mouse/.test(source), 'Spreadshirt marketplace toggle must prefer a real mouse click on the checkbox-linked visible wrapper.');
assert(/page\.mouse\.move/.test(source) && /page\.mouse\.down/.test(source) && /page\.mouse\.up/.test(source), 'Spreadshirt physical switch must use real Playwright mouse input.');
assert(/pagePointForFrameRect/.test(source), 'Spreadshirt physical switch must translate frame-local geometry to page coordinates.');
assert(/checkbox\?\.closest|checkbox\.closest/.test(source), 'Spreadshirt switch targeting must derive from the actual hidden checkbox DOM relationship.');
assert(/checkboxLinkedTargetRect/.test(source), 'Spreadshirt switch state must expose the checkbox-linked visible target geometry.');
assert(/checkbox\.click\(\)/.test(source), 'Hidden Spreadshirt checkbox must have native browser activation as a fallback.');
assert(/checkbox-native-click/.test(source), 'Native checkbox activation must be reported for diagnostics.');
assert(/waitForMarketplaceEnabled/.test(source), 'Every switch activation attempt must verify checked state or Save and publish.');
assert(/sell your products on the spreadshirt marketplace/.test(source), 'Spreadshirt physical toggle must anchor on the actual Marketplace card instead of the top navigation action.');
assert(/saveAndPublishVisibleAnywhere/.test(source), 'Save and publish visibility must remain usable as a positive ON-state signal.');
assert(/toggle-did-not-turn-on/.test(source), 'An unverified switch activation must fail instead of pretending the switch is ON.');
assert(/Final Review will continue/.test(source), 'Prepare must not be blocked when metadata is ready but the marketplace switch remains OFF.');
assert(/marketplaceSwitchPrepared/.test(source), 'Prepare must persist whether marketplace activation succeeded without blocking Final Review.');
assert(!/visible-control-unverified/.test(source), 'Old unverified toggle success fallback must not return.');

assert(/designIdFromEditorUrl/.test(strict), 'Strict publish verification must derive a unique Spreadshirt design ID from the editor URL.');
assert(/readEditorPublishStatus/.test(strict) && /verifyPage\.goto\(editorUrl/.test(strict), 'Strict publish verification must check the exact design editor before dashboard fallbacks.');
assert(/Name,\\s\*Id,\\s\*Tags/.test(strict), 'Strict publish verification must retain exact design-ID Marketplace search only as a fallback.');
assert(/exact-design-id-dom-not-found-search-returned-/.test(strict), 'Strict publish verification must reject ambiguous Marketplace search results.');
assert(/normalized === 'in review'/.test(strict) && /normalized === 'published'/.test(strict) && /normalized === 'draft'/.test(strict), 'Strict publish verification must distinguish Draft, In review and Published.');
assert(/trusted-playwright-button/.test(strict), 'Save and publish must use a trusted Playwright button click first.');
assert(/still shows Draft/.test(strict), 'Exact Draft status must block local Published state.');
assert(/removePublishLedgerEntry/.test(strict) && /reverted-false-positive/.test(strict), 'False local publishes must repair the ledger and return to Final Review.');
assert(/publishVerification:\s*'exact-design-id'/.test(strict), 'Successful publishes must persist exact-design-ID verification.');
assert(!/PUBLISHED_UNDER_REVIEW/.test(strict), 'Strict final layer must not trust generic page-text success banners by themselves.');

assert(/setAutomationWindowVisible\?\.\('spreadshirt', true\)/.test(debug), 'Diagnostic publish wrapper must enable visibility only for Spreadshirt automation Chrome.');
assert(/showAutomationWindow\(page\)/.test(debug) && /page\.bringToFront/.test(debug), 'Diagnostic publish wrapper must visibly foreground the existing Spreadshirt browser.');
assert(/return previousPublish\(projectId\)/.test(debug), 'Diagnostic wrapper must delegate to the existing publish implementation unchanged.');
assert(!/\.click\(|\.fill\(|\.goto\(|recordPublish|projects\.update/.test(debug), 'Diagnostic wrapper must not alter publish interactions or project state.');
assert(/setAutomationWindowVisible/.test(dock) && /showAutomationWindow/.test(dock), 'Chrome dock patch must support temporary visible automation windows.');
assert(/left:\s*60/.test(dock) && /top:\s*60/.test(dock), 'Diagnostic automation window must be moved back onto the visible desktop.');

const finalIndex = bootstrap.indexOf("require('./spreadshirtFinalApprovalSequencePatch')");
const strictIndex = bootstrap.indexOf("require('./spreadshirtStrictPublishVerifyPatch')");
const debugIndex = bootstrap.indexOf("require('./spreadshirtPublishBrowserDebugPatch')");
const uiIndex = bootstrap.indexOf("require('./spreadshirtAlphaUiPatch')");
assert(finalIndex >= 0 && strictIndex > finalIndex && debugIndex > strictIndex && uiIndex > debugIndex, 'Diagnostic browser wrapper must load after strict publish logic and before Spreadshirt UI injection.');

console.log('Spreadshirt exact switch + strict exact-editor/design-ID verification + visible publish-browser diagnostic smoke checks passed.');
