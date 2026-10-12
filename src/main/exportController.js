const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_WIDTH = 4500;
const OUTPUT_HEIGHT = 5400;
const TOP_CLEARANCE_OF_ARTWORK = 0.05;
const MIN_TOP_CLEARANCE_PX = 12;
const TRIM_THRESHOLD = 16;

function roundRatio(value) {
  return Math.round(value * 10000) / 10000;
}

function placementFromBounds(width, height) {
  const safeWidth = Number(width) || 0;
  const safeHeight = Number(height) || 0;
  const widthRatio = safeWidth / OUTPUT_WIDTH;
  const heightRatio = safeHeight / OUTPUT_HEIGHT;
  const aspectRatio = safeHeight > 0 ? safeWidth / safeHeight : 0;
  const validBounds = safeWidth > 0 && safeHeight > 0 && safeWidth <= OUTPUT_WIDTH && safeHeight <= OUTPUT_HEIGHT;

  return {
    // Top placement is now the universal ZeroPOD export default. Every design is
    // measured from its real visible alpha bounds and composed near the top of
    // the same 4500x5400 transparent canvas. Redbubble settings stay untouched.
    mode: validBounds ? 'top' : 'center',
    reason: validBounds ? 'universal-top-default' : 'invalid-bounds-fallback',
    width: safeWidth || null,
    height: safeHeight || null,
    widthRatio: validBounds ? roundRatio(widthRatio) : null,
    heightRatio: validBounds ? roundRatio(heightRatio) : null,
    aspectRatio: validBounds ? roundRatio(aspectRatio) : null
  };
}

function topClearancePxFor(visibleArtworkHeight) {
  const safeHeight = Math.max(1, Number(visibleArtworkHeight) || 1);
  // The user-facing 5% clearance is based on the visible artwork itself rather
  // than the whole 5400px canvas. This keeps all designs high while preserving
  // a small safety gap from the top edge.
  return Math.max(MIN_TOP_CLEARANCE_PX, Math.round(safeHeight * TOP_CLEARANCE_OF_ARTWORK));
}

async function analyzeVisibleArtwork(renderedBuffer) {
  const { data, info } = await sharp(renderedBuffer)
    .ensureAlpha()
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: TRIM_THRESHOLD
    })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    info,
    placement: placementFromBounds(info.width, info.height)
  };
}

async function writeTopPlacedArtwork(output, trimmedBuffer, info) {
  const left = Math.max(0, Math.round((OUTPUT_WIDTH - info.width) / 2));
  const desiredTop = topClearancePxFor(info.height);
  const top = Math.max(0, Math.min(desiredTop, OUTPUT_HEIGHT - info.height));

  await sharp({
    create: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: trimmedBuffer, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(output);

  return {
    left,
    top,
    topClearancePx: top,
    clearanceBasis: 'visible-artwork-height',
    clearanceRatio: TOP_CLEARANCE_OF_ARTWORK
  };
}

class ExportController {
  constructor({ projects }) {
    this.projects = projects;
  }

  async exportPng(projectId) {
    const project = this.projects.read(projectId);
    if (!project.vectorPath || !fs.existsSync(project.vectorPath)) {
      throw new Error('Vector file is missing. Complete the Vectorizer.ai step first.');
    }

    const ext = path.extname(project.vectorPath).toLowerCase();
    if (ext !== '.svg') {
      throw new Error('ZeroPOD currently exports from SVG. Download the SVG version from Vectorizer.ai.');
    }

    const output = path.join(this.projects.getProjectDir(projectId), 'final-4500x5400.png');
    const svgBuffer = fs.readFileSync(project.vectorPath);

    // Render exactly as before first, then measure the real visible alpha bounds.
    // The measured/trimmed artwork is what gets positioned near the top.
    const renderedBuffer = await sharp(svgBuffer, { density: 600 })
      .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    let placement = {
      mode: 'center',
      reason: 'analysis-fallback',
      width: null,
      height: null,
      widthRatio: null,
      heightRatio: null,
      aspectRatio: null,
      left: null,
      top: null,
      topClearancePx: null,
      clearanceBasis: null,
      clearanceRatio: null,
      automatic: true,
      universalDefault: true
    };

    try {
      const analysis = await analyzeVisibleArtwork(renderedBuffer);
      placement = { ...placement, ...analysis.placement };

      if (analysis.placement.mode === 'top') {
        const position = await writeTopPlacedArtwork(output, analysis.data, analysis.info);
        placement = { ...placement, ...position };
      } else {
        fs.writeFileSync(output, renderedBuffer);
      }
    } catch {
      // Bounds analysis must never make a previously working export fail. If the
      // artwork cannot be measured safely, fall back to the original contain PNG.
      placement.mode = 'center';
      placement.reason = 'analysis-fallback';
      fs.writeFileSync(output, renderedBuffer);
    }

    const updated = this.projects.update(projectId, {
      status: 'export-ready',
      finalPngPath: output,
      export: {
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        transparent: true,
        sourceVector: project.vectorPath,
        placement
      }
    });

    return { ok: true, path: output, placement, project: updated };
  }
}

module.exports = {
  ExportController,
  placementFromBounds,
  topClearancePxFor,
  analyzeVisibleArtwork,
  writeTopPlacedArtwork
};
