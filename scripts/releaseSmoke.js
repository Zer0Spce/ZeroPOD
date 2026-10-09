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

if (pkg.version !== '1.0.0') fail(`package.json version is ${pkg.version}; expected 1.0.0.`);
if (!html.includes('Windows only · v1.0')) fail('visible sidebar version is not v1.0.');

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
if (!html.includes('readiness.js')) fail('1.0 Readiness Center is not wired.');

if (!process.exitCode) console.log(`Release smoke check passed for ZeroPOD v${pkg.version}.`);
