const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExportController, placementFromBounds } = require('../src/main/exportController');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runExportCase(name, svg, expectedMode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `zeropod-${name}-`));
  const vectorPath = path.join(root, 'vector.svg');
  fs.writeFileSync(vectorPath, svg, 'utf8');

  const project = { id: name, vectorPath };
  const projects = {
    read: () => project,
    getProjectDir: () => root,
    update: (_id, patch) => Object.assign(project, patch)
  };

  try {
    const controller = new ExportController({ projects });
    const result = await controller.exportPng(name);
    assert(result.placement.mode === expectedMode, `${name}: expected ${expectedMode}, got ${result.placement.mode}`);

    const metadata = await sharp(result.path).metadata();
    assert(metadata.width === 4500, `${name}: expected width 4500, got ${metadata.width}`);
    assert(metadata.height === 5400, `${name}: expected height 5400, got ${metadata.height}`);
    assert(Boolean(metadata.hasAlpha), `${name}: output lost transparency`);

    if (expectedMode === 'top') {
      assert(result.placement.top === Math.round(5400 * 0.17), `${name}: unexpected top offset ${result.placement.top}`);
      assert(result.placement.heightRatio <= 0.40, `${name}: compact placement ratio is outside threshold`);
    } else {
      assert(result.placement.top === null, `${name}: normal design should keep existing centered export`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  assert(placementFromBounds(3200, 1800).mode === 'top', 'compact bounds should use top placement');
  assert(placementFromBounds(3200, 3000).mode === 'center', 'taller bounds should stay centered');

  await runExportCase(
    'compact',
    '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="600" viewBox="0 0 2000 600"><rect x="0" y="0" width="2000" height="600" rx="40" fill="#ef4444"/></svg>',
    'top'
  );

  await runExportCase(
    'full',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><rect x="0" y="0" width="1000" height="1400" rx="40" fill="#22c55e"/></svg>',
    'center'
  );

  console.log('Export placement smoke check passed.');
})().catch((error) => {
  console.error(`Export placement smoke check failed: ${error.message || error}`);
  process.exitCode = 1;
});
