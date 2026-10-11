const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
const index = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const appearance = fs.readFileSync(path.join(rendererDir, 'appearance.js'), 'utf8');
const researchUx = fs.readFileSync(path.join(rendererDir, 'researchUxPatch.js'), 'utf8');

if (!index.includes('<section id="dashboard" class="view active-view">')) throw new Error('Renderer dashboard shell missing.');
if (!index.includes('<script src="appearance.js"></script>')) throw new Error('Appearance bootstrap missing.');
if (!appearance.includes("loadZeroPODFeatureScript('research.js'")) throw new Error('Research renderer loader missing.');
if (!appearance.includes("loadZeroPODFeatureScript('researchUxPatch.js'")) throw new Error('Research UX safe loader missing.');
if (/executeJavaScript\s*\(/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'researchIpcPatch.js'), 'utf8'))) throw new Error('Research IPC must not inject renderer JavaScript at startup.');
if (!researchUx.includes('setLiveView')) throw new Error('Research live-view isolation patch missing.');

console.log('Renderer startup smoke passed.');
