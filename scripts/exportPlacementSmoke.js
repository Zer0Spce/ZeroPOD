const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExportController, placementFromBounds } = require('../src/main/exportController');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runExportCase(name, svg, expectedMode, expectedReason = null) {
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
    if (expectedReason) {
      assert(result.placement.reason === expectedReason, `${name}: expected reason ${expectedReason}, got ${result.placement.reason}`);
    }

    const metadata = await sharp(result.path).metadata();
    assert(metadata.width === 4500, `${name}: expected width 4500, got ${metadata.width}`);
    assert(metadata.height === 5400, `${name}: expected height 5400, got ${metadata.height}`);
    assert(Boolean(metadata.hasAlpha), `${name}: output lost transparency`);

    if (expectedMode === 'top') {
      assert(result.placement.top === Math.round(5400 * 0.17), `${name}: unexpected top offset ${result.placement.top}`);
      assert(
        result.placement.reason === 'compact-height' || result.placement.reason === 'wide-chest-artwork',
        `${name}: top placement did not come from a supported auto-placement rule`
      );
    } else {
      assert(result.placement.top === null, `${name}: normal design should keep existing centered export`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  const compact = placementFromBounds(3200, 1800);
  assert(compact.mode === 'top', 'compact bounds should use top placement');
  assert(compact.reason === 'compact-height', 'compact bounds should use compact-height reason');

  const wideChest = placementFromBounds(3600, 2500);
  assert(wideChest.mode === 'top', 'wide chest artwork should use top placement even above the compact-height cutoff');
  assert(wideChest.reason === 'wide-chest-artwork', 'wide chest artwork should use the wide-chest reason');

  assert(placementFromBounds(3200, 3000).mode === 'center', 'taller bounds should stay centered');

  await runExportCase(
    'compact',
    '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="600" viewBox="0 0 2000 600"><rect x="0" y="0" width="2000" height="600" rx="40" fill="#ef4444"/></svg>',
    'top',
    'compact-height'
  );

  await runExportCase(
    'wide-chest',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1000" viewBox="0 0 1800 1000"><rect x="0" y="0" width="1800" height="1000" rx="40" fill="#f59e0b"/></svg>',
    'top',
    'wide-chest-artwork'
  );

  await runExportCase(
    'full',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><rect x="0" y="0" width="1000" height="1400" rx="40" fill="#22c55e"/></svg>',
    'center',
    'normal-full-artwork'
  );

  console.log('Export placement smoke check passed.');
})().catch((error) => {
  console.error(`Export placement smoke check failed: ${error.message || error}`);
  process.exitCode = 1;
});
