const fs = require('fs');
const path = require('path');

const controllerPath = path.join(__dirname, '..', 'src', 'main', 'vectorizerController.js');
const source = fs.readFileSync(controllerPath, 'utf8');

const required = [
  'waitForDownloadOptions',
  'clickResultDownload',
  'clickFinalSvgDownload',
  'Browser.setDownloadBehavior',
  'File format',
  'Optimize for'
];

for (const token of required) {
  if (!source.includes(token)) {
    throw new Error(`Vectorizer flow smoke failed: missing ${token}`);
  }
}

console.log('Vectorizer two-stage flow smoke passed.');
