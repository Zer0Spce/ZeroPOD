const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const mainPath = (file) => path.join(root, 'src', 'main', file);
const main = (file) => fs.readFileSync(mainPath(file), 'utf8');
const renderer = (file) => fs.readFileSync(path.join(root, 'src', 'renderer', file), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

for (const file of ['spreadshirtSessionGatePatch.js', 'automationSpreadshirtAttentionPatch.js']) {
  const syntax = spawnSync(process.execPath, ['--check', mainPath(file)], { encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || `${file} syntax failed.`);
}

const routing = main('automationPodTargetsPatch.js');
const ipc = main('spreadshirtAlphaIpc.js');
const hidden = main('spreadshirtTrueHiddenChromePatch.js');
const flow = main('spreadshirtPublishBrowserDebugPatch.js');
const bootstrap = main('bootstrap.js');
const sessionGate = main('spreadshirtSessionGatePatch.js');
const attention = main('automationSpreadshirtAttentionPatch.js');
const uiPatch = main('spreadshirtAlphaUiPatch.js');
const targetsUi = renderer('automationPodTargetsUi.js');
const polish = renderer('spreadshirtBetaPolish.js');
const connections = renderer('connectionsExtraServices.js');

assert(/normalizeTargets/.test(routing), 'Automation POD target normalization is missing.');
assert(/redbubble:\s*true/.test(routing) && /spreadshirt:\s*false/.test(routing), 'Legacy/new Automation rows must default safely to Redbubble only.');
assert(/runSpreadshirtTarget/.test(routing), 'Automation does not route selected rows through Spreadshirt.');
assert(/spreadshirt\.prepare\(project\.id\)/.test(routing) && /spreadshirt\.publish\(project\.id\)/.test(routing), 'Automation must prepare and publish Spreadshirt when selected.');
assert(/targets\.redbubble/.test(routing) && /targets\.spreadshirt/.test(routing), 'Automation must support independent Redbubble and Spreadshirt selections.');
assert(/Published ✓ · \$\{targetLabel\(targets\)\}/.test(routing), 'Automation must complete only after all selected POD targets publish.');
assert(/require\('\.\/automationPodTargetsPatch'\)/.test(ipc), 'Automation POD routing patch must load before main creates the queue controller.');

assert(/data-pod-target="redbubble"/.test(targetsUi) && /data-pod-target="spreadshirt"/.test(targetsUi), 'Automation UI must show Redbubble and Spreadshirt checkboxes.');
assert(/at least one POD destination/i.test(targetsUi), 'Automation UI must prevent rows with no selected POD target.');
assert(/patch:\s*\{\s*targets\s*\}/.test(targetsUi), 'Automation target checkbox changes must persist to the queue row.');
assert(/Object\.defineProperty\(root, 'innerHTML'/.test(targetsUi), 'Automation POD controls must be injected synchronously into the normal row render.');
assert(/transformAutomationRows/.test(targetsUi) && /targetMarkup/.test(targetsUi), 'Automation row render transformer is missing.');
assert(!/new MutationObserver/.test(targetsUi), 'Automation POD target UI must not use a competing MutationObserver renderer.');
assert(/very same paint/.test(targetsUi), 'Automation target render should document the no-flicker same-paint contract.');

assert(/openDesigns\(page\)/.test(sessionGate), 'Spreadshirt gate must verify the live Marketplace Designs page.');
assert(/authStatus:\s*'verified'/.test(sessionGate), 'Successful live Spreadshirt gate verification must refresh the saved session state.');
assert(/Only downgrade/.test(sessionGate), 'Transient route failures must not erase a valid Spreadshirt login.');
assert(/authStatus:\s*'needs-login'/.test(sessionGate), 'A real Spreadshirt login screen must still block the gate.');
assert(/require\('\.\/spreadshirtSessionGatePatch'\)/.test(bootstrap), 'Live Spreadshirt session gate patch is not loaded.');

assert(/spreadshirt\.lastError/.test(attention), 'Spreadshirt Automation failures must be persisted on the project.');
assert(/status:\s*'needs-attention'/.test(attention) && /spreadshirt-attention/.test(attention), 'Spreadshirt failures must remain paused for user attention.');
assert(/previousRetry\.call/.test(attention) && /lastError:\s*null/.test(attention), 'Manual Retry must clear the Spreadshirt attention latch.');
assert(/require\('\.\/automationSpreadshirtAttentionPatch'\)/.test(bootstrap), 'Spreadshirt attention patch is not loaded.');

assert(/NEW_CHAT_KEY/.test(polish) && /zeroPodNewChatFixed/.test(polish), 'Spreadshirt New Chat control repair is missing.');
assert(/localStorage\.setItem\(NEW_CHAT_KEY, input\.checked \? '1' : '0'\)/.test(polish), 'Spreadshirt New Chat state must persist in the format the workflow reads.');
assert(/Automate everything/.test(polish), 'Spreadshirt Automate everything BETA control must remain available.');

assert(/spreadshirt/.test(connections) && /flyingResearch/.test(connections), 'Connections must expose Spreadshirt and Flying Research/Flying Upload sessions.');
assert(/Open Login Browser/.test(connections) && /Test Session/.test(connections), 'Extra Connections services need login and test controls.');
assert(/automationPodTargetsUi\.js/.test(uiPatch) && /connectionsExtraServices\.js/.test(uiPatch) && /spreadshirtBetaPolish\.js/.test(uiPatch), 'Renderer integration scripts are not injected.');

assert(/startChromeHideLease/.test(hidden), 'Native Spreadshirt hide lease is missing.');
assert(/ShowWindowAsync\(\$proc\.MainWindowHandle,0\)/.test(hidden), 'Native Spreadshirt hide lease must use SW_HIDE.');
assert(/startChromeHideLease/.test(flow), 'Spreadshirt prepare/publish must hold a native hide lease for the full action.');
assert(/nativeLease\.stop\(\)/.test(flow), 'Native hide lease must be released after the automatic action.');

console.log('Automation multi-POD + no-flicker UI + live Spreadshirt session verification + attention pause smoke passed.');
