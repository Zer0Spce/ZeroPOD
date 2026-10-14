const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const toggleFile = path.join(root, 'src/main/spreadshirtMarketplaceTogglePatch.js');
const strictFile = path.join(root, 'src/main/spreadshirtStrictPublishVerifyPatch.js');
const freshFile = path.join(root, 'src/main/spreadshirtFreshUploadIdentityPatch.js');
const transitionFile = path.join(root, 'src/main/spreadshirtUploadTransitionPatch.js');
const routeFile = path.join(root, 'src/main/spreadshirtMarketplaceRoutePatch.js');
const debugFile = path.join(root, 'src/main/spreadshirtPublishBrowserDebugPatch.js');
const dockFile = path.join(root, 'src/main/chromeDockPatch.js');
const backgroundFile = path.join(root, 'src/main/backgroundChromeLaunchPatch.js');
for (const file of [toggleFile, strictFile, freshFile, transitionFile, routeFile, debugFile, dockFile, backgroundFile]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || `${path.basename(file)} syntax failed.`);
}

const source = fs.readFileSync(toggleFile, 'utf8');
const strict = fs.readFileSync(strictFile, 'utf8');
const fresh = fs.readFileSync(freshFile, 'utf8');
const transition = fs.readFileSync(transitionFile, 'utf8');
const route = fs.readFileSync(routeFile, 'utf8');
const debug = fs.readFileSync(debugFile, 'utf8');
const dock = fs.readFileSync(dockFile, 'utf8');
const background = fs.readFileSync(backgroundFile, 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'src/main/bootstrap.js'), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/playwright-native-mouse/.test(source), 'Spreadshirt marketplace toggle must retain the trusted browser-mouse path.');
assert(/playwright-checkbox-wrapper-mouse/.test(source), 'Spreadshirt marketplace toggle must prefer a real mouse click on the checkbox-linked visible wrapper.');
assert(/page\.mouse\.move/.test(source) && /page\.mouse\.down/.test(source) && /page\.mouse\.up/.test(source), 'Spreadshirt physical switch must use real Playwright mouse input.');
assert(/checkbox\?\.closest|checkbox\.closest/.test(source), 'Spreadshirt switch targeting must derive from the actual hidden checkbox DOM relationship.');
assert(/checkbox\.click\(\)/.test(source), 'Hidden Spreadshirt checkbox must have native browser activation as a fallback.');
assert(/waitForMarketplaceEnabled/.test(source), 'Every switch activation attempt must verify checked state or Save and publish.');
assert(/toggle-did-not-turn-on/.test(source), 'An unverified switch activation must fail instead of pretending the switch is ON.');

assert(/designIdFromEditorUrl/.test(strict), 'Strict publish verification must derive a unique Spreadshirt design ID from the editor URL.');
assert(/readEditorPublishStatus/.test(strict) && /verifyPage\.goto\(editorUrl/.test(strict), 'Strict publish verification must check the exact design editor before dashboard fallbacks.');
assert(/normalized === 'in review'/.test(strict) && /normalized === 'published'/.test(strict) && /normalized === 'draft'/.test(strict), 'Strict publish verification must distinguish Draft, In review and Published.');
assert(/trusted-playwright-button/.test(strict), 'Save and publish must use a trusted Playwright button click first.');
assert(/still shows Draft/.test(strict), 'Exact Draft status must block local Published state.');
assert(/removePublishLedgerEntry/.test(strict) && /reverted-false-positive/.test(strict), 'False local publishes must repair the ledger and return to Final Review.');

assert(/forceMarketplaceDesigns/.test(fresh), 'Fresh Spreadshirt workflow must force the Designs index instead of inheriting a previous editor.');
assert(/Captured \$\{beforeCards\.length\} existing Spreadshirt design card/.test(fresh), 'Fresh upload flow must snapshot existing design cards before upload.');
assert(/waitForGenuinelyNewDesignCard/.test(fresh), 'Fresh upload flow must wait for a genuinely new card after upload.');
assert(/beforeIdentities/.test(fresh) && /beforeDesignIds/.test(fresh), 'Fresh-card detection must compare against pre-upload card identities and design IDs.');
assert(/previous first card was intentionally not opened/.test(fresh), 'Fresh upload flow must refuse to fall back to the previous first card.');
assert(/opened previous design .* instead of the new upload/.test(fresh), 'Fresh upload flow must stop if Spreadshirt opens a pre-existing design ID.');
assert(/uploadDesignId/.test(fresh) && /uploadCardIdentity/.test(fresh) && /editorUrl/.test(fresh), 'Fresh upload flow must persist exact design identity for later resume/publish verification.');

assert(/MARKETPLACE_DESIGN_EDITOR_RE/.test(transition), 'Spreadshirt upload verification must recognize a direct design-editor navigation as positive evidence.');
assert(/Design products/.test(transition) && /Metadata/.test(transition), 'Spreadshirt upload verification must recognize a fully rendered design editor.');
assert(!/reason:\s*['"]designs-index-after-upload-status['"]/.test(transition), 'Returning to Designs after Upload Status must never count as upload success by itself.');
assert(/returnedWithoutConfirmation/.test(transition) && /did not mark the file as uploaded/i.test(transition), 'Unconfirmed Designs returns must fail safely without recording upload success.');
assert(/UPLOAD_LIMIT_PATTERN/.test(transition) && /UPLOAD_REJECTION_PATTERN/.test(transition), 'Spreadshirt upload verification must detect upload limits and explicit file rejection states.');
assert(/Current page:/.test(transition) && /Saw Upload Status:/.test(transition) && /Page text:/.test(transition), 'Spreadshirt upload timeout must include useful live-page diagnostics.');
assert(/videoFlow\.waitForUploadResult = waitForUploadResultReliable/.test(transition), 'Strict Spreadshirt upload verification must replace the brittle helper before fresh upload logic imports it.');

assert(/async function clickDesignsNavigation\(page\)/.test(route), 'Spreadshirt Marketplace route recovery must expose a dedicated dashboard Designs-navigation helper.');
assert(/\/dashboard/.test(route) && /looksLikeDashboard/.test(route), 'Spreadshirt Marketplace route recovery must detect authenticated Dashboard redirects.');
assert(/a\[href="\/mp\/designs"\]/.test(route), 'Spreadshirt Dashboard recovery must prefer the first-party /mp/designs navigation link.');
assert(/clickDesignsNavigation\(page\)/.test(route) && /dashboardRecoveryAttempts/.test(route), 'Spreadshirt Marketplace wait must actively recover from Dashboard redirects instead of only timing out.');
assert(/Visible Designs links:/.test(route), 'Spreadshirt Marketplace timeout diagnostics must report visible Designs destinations.');

assert(/feature\.prepare = async function prepareWithFullVisibleSpreadshirt/.test(debug), 'Visible diagnostic wrapper must cover the full Spreadshirt prepare process.');
assert(/feature\.publish = async function publishWithFullVisibleSpreadshirt/.test(debug), 'Visible diagnostic wrapper must cover the full Spreadshirt publish process.');
assert(/__zeroPodHostWindow/.test(debug) && /\.minimize\?\./.test(debug), 'ZeroPOD must minimize during visible Spreadshirt debugging so Chrome stays in front.');
assert(/setInterval/.test(debug) && /showAutomationWindow\(page\)/.test(debug) && /page\.bringToFront/.test(debug), 'Spreadshirt Chrome must be repeatedly kept visible/in front during the whole stage.');
assert(!/\.click\(|\.fill\(|\.goto\(|recordPublish|projects\.update/.test(debug), 'Visibility wrapper must not alter Spreadshirt interactions or project state.');
assert(/setAutomationWindowVisible/.test(dock) && /showAutomationWindow/.test(dock), 'Chrome dock patch must support visible automation windows.');
assert(/__zeroPodVisibleAutomationServices/.test(dock) && /globalVisible\.add\(serviceId\)/.test(dock), 'Visible automation lease must be shared with the Chrome process launcher.');
assert(/partner\\\.spreadshirt\\\.com|partner\.spreadshirt\.com/.test(background), 'Background Chrome launcher must identify the Spreadshirt automation process.');
assert(/windowsHide:\s*false/.test(background) && /--window-position=60,60/.test(background), 'Leased Spreadshirt Chrome must launch visibly instead of starting hidden/off-screen.');
assert(/windowsHide:\s*true/.test(background) && /--window-position=-20000,-20000/.test(background), 'Other automation Chrome windows must retain the existing hidden background behavior.');

const videoIndex = bootstrap.indexOf("require('./spreadshirtVideoFlowPatch')");
const transitionIndex = bootstrap.indexOf("require('./spreadshirtUploadTransitionPatch')");
const editorResumeIndex = bootstrap.indexOf("require('./spreadshirtEditorResumePatch')");
const freshIndex = bootstrap.indexOf("require('./spreadshirtFreshUploadIdentityPatch')");
const strictIndex = bootstrap.indexOf("require('./spreadshirtStrictPublishVerifyPatch')");
const debugIndex = bootstrap.indexOf("require('./spreadshirtPublishBrowserDebugPatch')");
const uiIndex = bootstrap.indexOf("require('./spreadshirtAlphaUiPatch')");
assert(videoIndex >= 0 && transitionIndex > videoIndex && transitionIndex < freshIndex, 'Upload verification compatibility must load after the video helper and before fresh upload identity imports it.');
assert(editorResumeIndex >= 0 && freshIndex > editorResumeIndex, 'Fresh upload identity layer must supersede the old editor-resume prepare wrapper.');
assert(strictIndex > freshIndex && debugIndex > strictIndex && uiIndex > debugIndex, 'Full visible browser wrapper must load after final Spreadshirt publish logic and before UI injection.');

console.log('Spreadshirt exact switch + strict upload verification + dashboard-route recovery + fresh-card identity + visible-browser + strict publish verification smoke checks passed.');
