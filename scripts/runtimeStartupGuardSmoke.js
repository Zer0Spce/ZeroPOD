const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'src', 'main', 'bootstrap.js'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'src', 'main', 'startupWindowReliabilityPatch.js'), 'utf8');

if (!bootstrap.includes("require('./startupWindowReliabilityPatch')")) throw new Error('Startup reliability patch is not wired into bootstrap.');
if (!guard.includes("document.querySelector('.app-shell')")) throw new Error('Startup guard does not verify the app shell.');
if (!guard.includes("document.querySelector('#dashboard')")) throw new Error('Startup guard does not verify the dashboard.');
if (!guard.includes('startup.log')) throw new Error('Startup guard does not emit diagnostics.');
if (!guard.includes('ZeroPOD could not load the app screen')) throw new Error('Startup fallback page missing.');

console.log('Runtime startup guard smoke passed.');
