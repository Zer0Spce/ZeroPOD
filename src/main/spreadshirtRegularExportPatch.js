const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { SpreadshirtAlphaFeature } = require('./spreadshirtAlphaFeature');
const { ExportController } = require('./exportController');

const MAX_SPREADSHIRT_DIMENSION = 4000;
const MAX_SPREADSHIRT_BYTES = 10 * 1024 * 1024;
const SPREADSHIRT_DENSITY = 200;
const DIMENSION_ATTEMPTS = [4000, 3800, 3600, 3400, 3200, 3000, 2800, 2600, 2400];

async function makeSpreadshirtUploadCopy(sourceFile, outputFile) {
  for (const dimension of DIMENSION_ATTEMPTS) {
    const buffer = await sharp(sourceFile)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 12 })
      .resize({
        width: dimension,
        height: dimension,
        fit: 'inside',
        withoutEnlargement: true
      })
      .ensureAlpha()
      .withMetadata({ density: SPREADSHIRT_DENSITY })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    const info = await sharp(buffer).metadata();
    if ((info.width || 0) > MAX_SPREADSHIRT_DIMENSION || (info.height || 0) > MAX_SPREADSHIRT_DIMENSION) continue;
    if (buffer.length > MAX_SPREADSHIRT_BYTES) continue;

    fs.writeFileSync(outputFile, buffer);
    return {
      width: info.width || null,
      height: info.height || null,
      bytes: buffer.length,
      transparent: Boolean(info.hasAlpha),
      density: SPREADSHIRT_DENSITY
    };
  }

  throw new Error('ZeroPOD could not create a Spreadshirt upload copy within the 4000×4000 / 10 MB artwork limits.');
}

SpreadshirtAlphaFeature.prototype.renderSpreadshirtPng = async function renderSpreadshirtPng(projectId) {
  const exporter = new ExportController({ projects: this.projects });
  const result = await exporter.exportPng(projectId);
  const project = this.projects.read(projectId);
  const standardFile = result.path || project.finalPngPath;
  if (!standardFile || !fs.existsSync(standardFile)) throw new Error('ZeroPOD 4500×5400 PNG export is missing.');

  const standardInfo = await sharp(standardFile).metadata();
  if (standardInfo.format !== 'png' || !standardInfo.hasAlpha) {
    throw new Error('The standard ZeroPOD export must be a transparent PNG before Spreadshirt preparation.');
  }

  const uploadFile = path.join(this.projects.getProjectDir(projectId), 'spreadshirt-upload.png');
  const spreadshirtInfo = await makeSpreadshirtUploadCopy(standardFile, uploadFile);

  const updated = this.projects.update(projectId, {
    spreadshirt: {
      ...(project.spreadshirt || {}),
      alpha: true,
      pngPath: uploadFile,
      sourceStandardPngPath: standardFile,
      export: {
        ...spreadshirtInfo,
        maxDimension: MAX_SPREADSHIRT_DIMENSION,
        maxBytes: MAX_SPREADSHIRT_BYTES,
        source: 'standard-zeropod-derived-spreadshirt',
        sourceStandardPngPath: standardFile,
        sourceStandardWidth: standardInfo.width || 4500,
        sourceStandardHeight: standardInfo.height || 5400,
        sourceVector: project.vectorPath || null
      },
      exportedAt: new Date().toISOString(),
      status: 'export-ready'
    }
  });

  return { ok: true, path: uploadFile, export: updated.spreadshirt.export, project: updated };
};

SpreadshirtAlphaFeature.prototype.validateArtwork = async function validateArtwork(project) {
  const errors = [];
  const warnings = [];
  const file = project.spreadshirt?.pngPath;
  if (!file || !fs.existsSync(file)) {
    return { ok: false, errors: ['Spreadshirt upload PNG is missing. Export the artwork again.'], warnings, artwork: null };
  }

  const stat = fs.statSync(file);
  const info = await sharp(file).metadata();
  if (info.format !== 'png') errors.push('Spreadshirt artwork must be PNG.');
  if (!info.hasAlpha) errors.push('Spreadshirt artwork must preserve transparency.');
  if ((info.width || 0) > MAX_SPREADSHIRT_DIMENSION || (info.height || 0) > MAX_SPREADSHIRT_DIMENSION) {
    errors.push('Spreadshirt upload artwork must be no larger than 4000×4000 pixels.');
  }
  if (stat.size > MAX_SPREADSHIRT_BYTES) errors.push('Spreadshirt upload artwork must be 10 MB or smaller.');
  if ((info.density || SPREADSHIRT_DENSITY) < SPREADSHIRT_DENSITY) warnings.push('Spreadshirt recommends at least 200 dpi for pixel artwork.');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    artwork: {
      width: info.width || null,
      height: info.height || null,
      format: info.format || null,
      hasAlpha: Boolean(info.hasAlpha),
      bytes: stat.size,
      density: info.density || SPREADSHIRT_DENSITY,
      source: 'standard-zeropod-derived-spreadshirt',
      sourceStandardPngPath: project.spreadshirt?.sourceStandardPngPath || project.finalPngPath || null
    }
  };
};

module.exports = {
  MAX_SPREADSHIRT_DIMENSION,
  MAX_SPREADSHIRT_BYTES,
  SPREADSHIRT_DENSITY,
  makeSpreadshirtUploadCopy
};
