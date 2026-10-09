const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'src', 'renderer');
const indexPath = path.join(rendererDir, 'index.html');
const packagePath = path.join(root, 'package.json');

function fail(message) {
  console.error(`Release smoke check failed: ${message}`);
  process.exitCode = 1;
}

const html = fs.readFileSync(indexPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const visibleVersion = `Windows only · v${pkg.version}`;

if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(pkg.version)) fail(`package.json version is not a valid release version: ${pkg.version}`);
if (!html.includes(visibleVersion)) fail(`visible sidebar version does not match package.json (${visibleVersion}).`);

const required = ['styles.css', 'theme.css', 'app.js', 'connections.js', 'automation.js', 'reviewQueue.js', 'automationBatch.js', 'publishQueue.js', 'workspace.js', 'appearance.js', 'readiness.js'];
for (const asset of required) {
  if (!html.includes(`"${asset}"`)) fail(`${asset} is not loaded by index.html.`);
  if (!fs.existsSync(path.join(rendererDir, asset))) fail(`${asset} is referenced but missing on disk.`);
}

const srcRefs = [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map((match) => match[1]);
for (const ref of srcRefs) {
  if (/^https?:/i.test(ref)) continue;
  if (!fs.existsSync(path.resolve(rendererDir, ref))) fail(`Broken renderer asset reference: ${ref}`);
}

if (!html.includes('appearance.js') || !html.includes('theme.css')) fail('Appearance mode assets are not fully wired.');
if (!html.includes('readiness.js')) fail('Readiness Center is not wired.');

if (!process.exitCode) console.log(`Release smoke check passed for ZeroPOD v${pkg.version}.`);
