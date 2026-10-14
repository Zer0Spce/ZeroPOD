const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'main');
const launch = fs.readFileSync(path.join(root, 'backgroundChromeLaunchPatch.js'), 'utf8');
const native = fs.readFileSync(path.join(root, 'spreadshirtNativeForegroundPatch.js'), 'utf8');
const flow = fs.readFileSync(path.join(root, 'spreadshirtPublishBrowserDebugPatch.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/--window-position=-20000,-20000/.test(launch), 'automation Chrome must launch off-screen');
assert(/windowsHide:\s*true/.test(launch), 'automation Chrome process must launch hidden on Windows');
assert(!/spreadshirtVisible/.test(launch), 'Spreadshirt must not have a visible launch exception');

assert(/serviceId === 'spreadshirt'/.test(native), 'Spreadshirt focus override is missing');
assert(/keepAutomationWindowOffscreen\(page\)/.test(native), 'Spreadshirt focus override must keep Chrome off-screen');
assert(/hidden:\s*true/.test(native), 'Spreadshirt focus override must report hidden mode');

assert(/setAutomationWindowVisible\?\.\('spreadshirt', false\)/.test(flow), 'Spreadshirt prepare/publish must force hidden mode');
assert(/keepAutomationWindowOffscreen\(page\)/.test(flow), 'Spreadshirt prepare/publish must keep Chrome off-screen');
assert(!/minimizeZeroPod/.test(flow), 'ZeroPOD must not be minimized for Spreadshirt automation');
assert(!/setInterval/.test(flow), 'Spreadshirt must not run foreground-focus timers');

console.log('Spreadshirt hidden Chrome smoke passed.');
