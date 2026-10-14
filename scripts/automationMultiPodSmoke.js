const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const main = (file) => fs.readFileSync(path.join(root, 'src', 'main', file), 'utf8');
const renderer = (file) => fs.readFileSync(path.join(root, 'src', 'renderer', file), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

const routing = main('automationPodTargetsPatch.js');
const ipc = main('spreadshirtAlphaIpc.js');
const hidden = main('spreadshirtTrueHiddenChromePatch.js');
const flow = main('spreadshirtPublishBrowserDebugPatch.js');
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
assert(/observer\.observe\(root, \{ childList: true \}\)/.test(targetsUi), 'Automation target UI should observe only queue-row replacement.');
assert(!/observer\.observe\(document\.documentElement/.test(targetsUi), 'Automation target UI must not observe its own subtree changes and create a mutation loop.');
assert(/block\.dataset\.signature/.test(targetsUi), 'Automation target UI must avoid rebuilding unchanged target controls every poll.');

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

console.log('Automation multi-POD + Spreadshirt controls + extra Connections smoke passed.');
