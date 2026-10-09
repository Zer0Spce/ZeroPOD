const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function canonical(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function validateMetadata(metadata, allProjects = [], currentProjectId = null) {
  const errors = [];
  const warnings = [];
  const title = normalize(metadata?.title);
  const mainTag = normalize(metadata?.mainTag);
  const description = normalize(metadata?.description);
  const supportingTags = Array.isArray(metadata?.supportingTags)
    ? metadata.supportingTags.map(normalize).filter(Boolean)
    : [];

  if (!title) errors.push('Title is required.');
  if (!mainTag) errors.push('Exactly one Main Tag is required.');
  if (!description) errors.push('Short Description is required.');
  if (supportingTags.length !== 14) errors.push('Exactly 14 Supporting Tags are required.');

  const seen = new Set();
  for (const tag of [mainTag, ...supportingTags]) {
    const key = canonical(tag);
    if (!key) continue;
    if (seen.has(key)) errors.push(`Duplicate or near-duplicate tag: ${tag}`);
    seen.add(key);
  }

  if (title.length > 100) warnings.push('Title is longer than 100 characters; consider shortening it.');
  if (description.length > 500) warnings.push('Description is long; Redbubble copy may be cleaner if shortened.');

  const duplicate = allProjects.find((project) => project.id !== currentProjectId && canonical(project.metadata?.title) && canonical(project.metadata?.title) === canonical(title));
  if (duplicate) warnings.push(`Another local ZeroPOD project already uses this title: ${duplicate.id}`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metadata: { title, mainTag, supportingTags, description, optimizationMode: 'POD WINNER' }
  };
}

async function validateArtwork(project) {
  const errors = [];
  const warnings = [];
  const result = { width: null, height: null, format: null, hasAlpha: null, sha256: null };
  const file = project.finalPngPath;

  if (!file || !fs.existsSync(file)) {
    errors.push('Final PNG is missing.');
    return { ok: false, errors, warnings, artwork: result };
  }

  const metadata = await sharp(file).metadata();
  result.width = metadata.width || null;
  result.height = metadata.height || null;
  result.format = metadata.format || null;
  result.hasAlpha = Boolean(metadata.hasAlpha);
  result.sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  if (metadata.format !== 'png') errors.push('Final artwork must be a PNG.');
  if (metadata.width !== 4500 || metadata.height !== 5400) errors.push(`Final PNG must be exactly 4500×5400. Current: ${metadata.width || '?'}×${metadata.height || '?'}.`);
  if (!metadata.hasAlpha) errors.push('Final PNG must preserve transparency/alpha.');

  return { ok: errors.length === 0, errors, warnings, artwork: result };
}

async function validateProject(project, allProjects = []) {
  const metadata = validateMetadata(project.metadata, allProjects, project.id);
  const artwork = await validateArtwork(project);
  const warnings = [...metadata.warnings, ...artwork.warnings, 'Confirm slogan spelling and trademark safety manually before publishing.'];
  const errors = [...metadata.errors, ...artwork.errors];
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks: {
      metadata: metadata.ok,
      artwork: artwork.ok,
      finalManualReviewRequired: true
    },
    artwork: artwork.artwork
  };
}

module.exports = { validateMetadata, validateArtwork, validateProject };
