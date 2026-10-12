const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_WIDTH = 4500;
const OUTPUT_HEIGHT = 5400;
const COMPACT_MAX_HEIGHT_RATIO = 0.40;
const WIDE_CHEST_MAX_HEIGHT_RATIO = 0.60;
const WIDE_CHEST_MIN_ASPECT_RATIO = 1.35;
const COMPACT_TOP_PLACEMENT_RATIO = 0.08;
const WIDE_CHEST_TOP_PLACEMENT_RATIO = 0.05;
const TRIM_THRESHOLD = 8;

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

  const compactByHeight = validBounds && heightRatio <= COMPACT_MAX_HEIGHT_RATIO;
  const wideChestArtwork = validBounds
    && heightRatio <= WIDE_CHEST_MAX_HEIGHT_RATIO
    && aspectRatio >= WIDE_CHEST_MIN_ASPECT_RATIO;

  let reason = 'normal-full-artwork';
  if (compactByHeight) reason = 'compact-height';
  else if (wideChestArtwork) reason = 'wide-chest-artwork';

  return {
    mode: compactByHeight || wideChestArtwork ? 'top' : 'center',
    reason,
    width: safeWidth || null,
    height: safeHeight || null,
    widthRatio: validBounds ? roundRatio(widthRatio) : null,
    heightRatio: validBounds ? roundRatio(heightRatio) : null,
    aspectRatio: validBounds ? roundRatio(aspectRatio) : null
  };
}

function topPlacementRatioFor(reason) {
  return reason === 'wide-chest-artwork'
    ? WIDE_CHEST_TOP_PLACEMENT_RATIO
    : COMPACT_TOP_PLACEMENT_RATIO;
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

async function writeTopPlacedArtwork(output, trimmedBuffer, info, reason) {
  const left = Math.max(0, Math.round((OUTPUT_WIDTH - info.width) / 2));
  const topRatio = topPlacementRatioFor(reason);
  const desiredTop = Math.round(OUTPUT_HEIGHT * topRatio);
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

  return { left, top, topRatio };
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

    // Preserve the proven 4500x5400 contain render as the baseline. Auto placement
    // is applied only after we inspect the actual non-transparent artwork bounds.
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
      topRatio: null,
      automatic: true
    };

    try {
      const analysis = await analyzeVisibleArtwork(renderedBuffer);
      placement = { ...placement, ...analysis.placement };

      if (analysis.placement.mode === 'top') {
        const position = await writeTopPlacedArtwork(
          output,
          analysis.data,
          analysis.info,
          analysis.placement.reason
        );
        placement.left = position.left;
        placement.top = position.top;
        placement.topRatio = position.topRatio;
      } else {
        // Normal/full designs remain on the exact existing export path.
        fs.writeFileSync(output, renderedBuffer);
      }
    } catch {
      // Bounds analysis must never make a previously working export fail. If the
      // artwork cannot be measured safely, keep the original centered result.
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

module.exports = { ExportController, placementFromBounds, topPlacementRatioFor };
