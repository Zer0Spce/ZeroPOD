const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ExportController, placementFromBounds, topClearancePxFor } = require('./exportController');

const OUTPUT_WIDTH = 4500;
const OUTPUT_HEIGHT = 5400;
const TRIM_THRESHOLD = 16;
const PNG_COMPRESSION_LEVEL = 6;

async function analyzeVisibleArtworkFast(renderedBuffer) {
  const { data, info } = await sharp(renderedBuffer)
    .ensureAlpha()
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: TRIM_THRESHOLD
    })
    .png({ compressionLevel: PNG_COMPRESSION_LEVEL, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  return { data, info, placement: placementFromBounds(info.width, info.height) };
}

async function writeTopPlacedArtworkFast(output, trimmedBuffer, info) {
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
    .png({ compressionLevel: PNG_COMPRESSION_LEVEL, adaptiveFiltering: true })
    .toFile(output);

  return {
    left,
    top,
    topClearancePx: top,
    clearanceBasis: 'visible-artwork-height',
    clearanceRatio: 0.05
  };
}

ExportController.prototype.exportPng = async function exportPngFast(projectId) {
  const project = this.projects.read(projectId);
  if (!project.vectorPath || !fs.existsSync(project.vectorPath)) {
    throw new Error('Vector file is missing. Complete the Vectorizer.ai step first.');
  }
  if (path.extname(project.vectorPath).toLowerCase() !== '.svg') {
    throw new Error('ZeroPOD currently exports from SVG. Download the SVG version from Vectorizer.ai.');
  }

  const output = path.join(this.projects.getProjectDir(projectId), 'final-4500x5400.png');
  const svgBuffer = await fs.promises.readFile(project.vectorPath);

  // PNG compression level changes file-encoding effort only; artwork pixels,
  // transparency, dimensions, placement and Redbubble behavior remain identical.
  const renderedBuffer = await sharp(svgBuffer, { density: 600 })
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ compressionLevel: PNG_COMPRESSION_LEVEL, adaptiveFiltering: true })
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
    const analysis = await analyzeVisibleArtworkFast(renderedBuffer);
    placement = { ...placement, ...analysis.placement };
    if (analysis.placement.mode === 'top') {
      placement = { ...placement, ...(await writeTopPlacedArtworkFast(output, analysis.data, analysis.info)) };
    } else {
      await fs.promises.writeFile(output, renderedBuffer);
    }
  } catch {
    placement.mode = 'center';
    placement.reason = 'analysis-fallback';
    await fs.promises.writeFile(output, renderedBuffer);
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
};

module.exports = { analyzeVisibleArtworkFast, writeTopPlacedArtworkFast, PNG_COMPRESSION_LEVEL };
