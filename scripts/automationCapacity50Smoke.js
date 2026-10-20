const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

const renderer = read('src/renderer/automationCapacity50.js');
const main = read('src/main/automationCapacity50MainPatch.js');
const injector = read('src/main/automationNewChatUiPatch.js');
const flyingIpc = read('src/main/flyingResearchIpc.js');

assert(/MAX_ROWS\s*=\s*50/.test(renderer), 'Renderer capacity must be 50.');
assert(/slice\(0,\s*MAX_ROWS\)/.test(renderer), 'Renderer must display up to 50 rows.');
assert(/snapshot\.rows\.length\s*>=\s*MAX_ROWS/.test(renderer), 'Add-row guard must use the 50-row limit.');
assert(/clearInterval\(automationPoll\)/.test(renderer), '50-row renderer must stop the old 30-row poll.');
assert(/__zeroPODAutomationCapacity50Poll/.test(renderer), '50-row renderer must own the single replacement poll.');
assert(/refreshAutomationListV2\s*=\s*refresh50/.test(renderer), 'Global refresh binding must use the 50-row renderer.');
assert(/automationCapacity50\.js/.test(injector), 'Automation 50-row renderer patch must be injected.');

assert(/MAX_AUTOMATION_ROWS\s*=\s*50/.test(main), 'Main Automation capacity must be 50.');
assert(/AutomationQueueStore\.prototype\.addRows/.test(main), 'Queue store must enforce the 50-row ceiling.');
assert(/FlyingResearchFeature\.prototype\.addToAutomation/.test(main), 'Flying import path must use the 50-row implementation.');
assert(!/fakeLengthRows|new Proxy\(rows/.test(main), 'Flying import must not fake queue length or proxy the row array.');
assert(/this\.automationStore\.addRows\(accepted\)/.test(main), 'Flying import must write accepted rows through the real queue store.');
assert(/require\('\.\/automationCapacity50MainPatch'\)/.test(flyingIpc), 'Flying IPC must load the 50-row main patch.');

console.log('Automation 50-row capacity + Flying handoff smoke passed.');
