const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const rendererFile = path.join(root, 'src/renderer/spreadshirtBetaPolish.js');
const hiddenFile = path.join(root, 'src/main/spreadshirtTrueHiddenChromePatch.js');
const uiPatchFile = path.join(root, 'src/main/spreadshirtAlphaUiPatch.js');

for (const file of [rendererFile, hiddenFile, uiPatchFile]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || `${path.basename(file)} syntax failed.`);
}

const renderer = fs.readFileSync(rendererFile, 'utf8');
const hidden = fs.readFileSync(hiddenFile, 'utf8');
const uiPatch = fs.readFileSync(uiPatchFile, 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(/\.nav\[data-view="spreadshirtAlpha"\]/.test(renderer) && /textContent = 'Spreadshirt'/.test(renderer), 'Spreadshirt tab must remove visible ALPHA branding.');
assert(/#spreadshirtAlpha h2/.test(renderer), 'Spreadshirt heading must be normalized without ALPHA branding.');
assert(/\.nav\[data-view="create"\]/.test(renderer) && /textContent = 'Redbubble'/.test(renderer), 'Unified Workflow tab must be renamed Redbubble.');
assert(/#create h2/.test(renderer) && /'Workflow'/.test(renderer), 'Redbubble heading rename must specifically replace the old Workflow heading.');
assert(/Automate everything/.test(renderer) && /uw-option-beta/.test(renderer) && /uw-beta-pill/.test(renderer), 'Spreadshirt Automate everything must visually match the Redbubble beta control.');
assert(/Skips both approval checks and publishes automatically\./.test(renderer), 'Spreadshirt beta warning must explain that both approvals are skipped.');
assert(/Beta automation cannot guarantee product placement, listing accuracy, or the final Spreadshirt result\./.test(renderer), 'Spreadshirt beta warning must disclose placement/listing/final-result risk.');
assert(/ssPassImage/.test(renderer) && /pass\.click\(\)/.test(renderer), 'Automate everything must auto-pass the generated-image approval.');
assert(/ssPublish/.test(renderer) && /publish\.click\(\)/.test(renderer), 'Automate everything must auto-pass final review and publish.');
assert(/spreadshirt\.publishedAt/.test(renderer), 'Automate everything must stop once Spreadshirt publish is recorded.');

assert(/ShowWindowAsync\(\$proc\.MainWindowHandle,0\)/.test(hidden), 'Spreadshirt automation must use the native Windows SW_HIDE path.');
assert(/chrome\.exe/.test(hidden) && /msedge\.exe/.test(hidden), 'Native hide must cover Chrome and Edge automation windows.');
assert(/ensureServiceWithNativeSpreadshirtHide/.test(hidden) && /hideChromeWindowByProfile\(profilePath, 9000\)/.test(hidden), 'Native hide must start before/while the automation service launches.');
assert(/focusAutomationWindowWithNativeSpreadshirtHide/.test(hidden), 'Foreground requests during Spreadshirt automation must remain hidden.');
assert(/openSpreadshirtExplicitlyVisible/.test(hidden) && /showChromeWindowByProfile/.test(hidden), 'Explicit Open Spreadshirt must remain available for intentional manual inspection.');

assert(/require\('\.\/spreadshirtTrueHiddenChromePatch'\)/.test(uiPatch), 'Spreadshirt native-hide patch must load with the Spreadshirt UI layer.');
assert(/rendererScript\('spreadshirtBetaPolish\.js'\)/.test(uiPatch), 'Spreadshirt beta polish renderer must be injected after the core Spreadshirt UI.');

console.log('Spreadshirt beta polish smoke passed: branding cleanup, Redbubble rename, auto approvals/publish, and native hidden browser behavior are wired.');