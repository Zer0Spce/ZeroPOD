const fs = require('fs');
const sharp = require('sharp');
const { SpreadshirtAlphaFeature } = require('./spreadshirtAlphaFeature');
const { ExportController } = require('./exportController');

SpreadshirtAlphaFeature.prototype.renderSpreadshirtPng = async function renderSpreadshirtPng(projectId) {
  const exporter = new ExportController({ projects: this.projects });
  const result = await exporter.exportPng(projectId);
  const project = this.projects.read(projectId);
  const file = result.path || project.finalPngPath;
  if (!file || !fs.existsSync(file)) throw new Error('ZeroPOD 4500×5400 PNG export is missing.');
  const info = await sharp(file).metadata();
  const stat = fs.statSync(file);
  const updated = this.projects.update(projectId, {
    spreadshirt: {
      ...(project.spreadshirt || {}),
      alpha: true,
      pngPath: file,
      export: {
        width: info.width || 4500,
        height: info.height || 5400,
        bytes: stat.size,
        transparent: Boolean(info.hasAlpha),
        source: 'standard-zeropod-4500x5400',
        sourceVector: project.vectorPath || null
      },
      exportedAt: new Date().toISOString(),
      status: 'export-ready'
    }
  });
  return { ok: true, path: file, export: updated.spreadshirt.export, project: updated };
};

SpreadshirtAlphaFeature.prototype.validateArtwork = async function validateArtwork(project) {
  const errors = [];
  const warnings = [];
  const file = project.spreadshirt?.pngPath || project.finalPngPath;
  if (!file || !fs.existsSync(file)) {
    return { ok: false, errors: ['Spreadshirt PNG is missing. Export the standard ZeroPOD 4500×5400 PNG first.'], warnings, artwork: null };
  }
  const stat = fs.statSync(file);
  const info = await sharp(file).metadata();
  if (info.format !== 'png') errors.push('Spreadshirt artwork must be PNG.');
  if (!info.hasAlpha) errors.push('Spreadshirt artwork must preserve transparency.');
  if (info.width !== 4500 || info.height !== 5400) warnings.push(`Artwork is ${info.width || '?'}×${info.height || '?'}; ZeroPOD normally uses 4500×5400 for Spreadshirt.`);
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
      source: 'standard-zeropod-4500x5400'
    }
  };
};

module.exports = {};
