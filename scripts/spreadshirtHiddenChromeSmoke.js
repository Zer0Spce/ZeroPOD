const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'main');
const launch = fs.readFileSync(path.join(root, 'backgroundChromeLaunchPatch.js'), 'utf8');
const native = fs.readFileSync(path.join(root, 'spreadshirtNativeForegroundPatch.js'), 'utf8');
const flow = fs.readFileSync(path.join(root, 'spreadshirtPublishBrowserDebugPatch.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');

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
assert(!/spreadshirtTrueHiddenChromePatch/.test(flow), 'Spreadshirt working flow must not use native SW_HIDE; it breaks rendered card verification');
assert(!/hideChromeWindowByProfile/.test(flow), 'Spreadshirt working flow must not repeatedly SW_HIDE the browser window');
assert(!/startChromeHideLease/.test(flow), 'Spreadshirt working flow must not start the native SW_HIDE lease');
assert(!/minimizeZeroPod/.test(flow), 'ZeroPOD must not be minimized for Spreadshirt automation');
assert(!/setInterval/.test(flow), 'Spreadshirt must not run foreground-focus timers');

const postUpload = bootstrap.indexOf("require('./spreadshirtPostUploadCardVerifyPatch')");
const recovery = bootstrap.indexOf("require('./spreadshirtAutomationUploadRecoveryPatch')");
const browserWrapper = bootstrap.indexOf("require('./spreadshirtPublishBrowserDebugPatch')");
assert(postUpload >= 0 && recovery > postUpload, 'Automation upload recovery must load after the proven post-upload verifier');
assert(browserWrapper > recovery, 'Off-screen browser wrapper must load after Automation upload recovery');
assert(/require\('\.\/flyingResearchCacheUiPatch'\)/.test(bootstrap), 'Flying Research cache UI patch must be loaded');

console.log('Spreadshirt rendered off-screen Chrome smoke passed.');
