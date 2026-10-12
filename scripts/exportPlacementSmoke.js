const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  ExportController,
  placementFromBounds,
  topClearancePxFor
} = require('../src/main/exportController');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function firstVisibleAlphaRow(filePath, scanHeight = 400) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .extract({ left: 0, top: 0, width: 4500, height: scanHeight })
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha > 16) return y;
    }
  }
  return -1;
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
      const expectedTop = topClearancePxFor(result.placement.height);
      assert(result.placement.top === expectedTop, `${name}: expected near-edge top ${expectedTop}, got ${result.placement.top}`);
      assert(result.placement.clearanceBasis === 'visible-artwork-height', `${name}: wrong clearance basis`);
      assert(result.placement.clearanceRatio === 0.05, `${name}: expected 5% visible-artwork clearance`);
      const firstRow = await firstVisibleAlphaRow(result.path);
      assert(firstRow >= 0, `${name}: no visible artwork found near top`);
      assert(Math.abs(firstRow - expectedTop) <= 2, `${name}: visible art starts at ${firstRow}, expected ${expectedTop}`);
      assert(firstRow < 180, `${name}: compact artwork is still too low at row ${firstRow}`);
    } else {
      assert(result.placement.top === null, `${name}: normal design should keep existing centered export`);
      assert(result.placement.clearanceBasis === null, `${name}: normal design should not get compact clearance`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  const compact = placementFromBounds(3200, 1800);
  assert(compact.mode === 'top', 'compact bounds should use top placement');
  assert(compact.reason === 'compact-height', 'compact bounds should use compact-height reason');
  assert(topClearancePxFor(1800) === 90, 'compact clearance should be 5% of visible artwork height');

  const wideCompact = placementFromBounds(3600, 2500);
  assert(wideCompact.mode === 'top', 'wide compact chest artwork should use top placement');
  assert(wideCompact.reason === 'compact-wide', 'wide compact artwork should use compact-wide reason');
  assert(topClearancePxFor(2500) === 125, 'wide compact clearance should be 5% of visible artwork height');

  assert(placementFromBounds(3200, 3600).mode === 'center', 'tall/full bounds should stay centered');

  await runExportCase(
    'compact',
    '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="600" viewBox="0 0 2000 600"><rect x="0" y="0" width="2000" height="600" rx="40" fill="#ef4444"/></svg>',
    'top',
    'compact-height'
  );

  await runExportCase(
    'wide-compact',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1000" viewBox="0 0 1800 1000"><rect x="0" y="0" width="1800" height="1000" rx="40" fill="#f59e0b"/></svg>',
    'top'
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
