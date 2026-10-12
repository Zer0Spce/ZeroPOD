const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFERENCE_DIFF_MAX = 6.0;
const MAX_NETWORK_REFERENCE_RETRIES = 6;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function normalizedPixels(input) {
  return sharp(input, { failOn: 'none' })
    .rotate()
    .resize(32, 32, { fit: 'fill', kernel: 'lanczos3' })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer();
}

async function visualDifference(leftInput, rightInput) {
  const [left, right] = await Promise.all([
    normalizedPixels(leftInput),
    normalizedPixels(rightInput)
  ]);
  if (!left.length || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

async function isReferenceImage(candidatePath, referencePath) {
  if (!candidatePath || !referencePath || !fs.existsSync(candidatePath) || !fs.existsSync(referencePath)) return false;

  try {
    const candidate = fs.readFileSync(candidatePath);
    const reference = fs.readFileSync(referencePath);
    if (candidate.length === reference.length && sha256(candidate) === sha256(reference)) return true;
    const diff = await visualDifference(candidatePath, referencePath);
    return Number.isFinite(diff) && diff <= REFERENCE_DIFF_MAX;
  } catch {
    return false;
  }
}

function findReferencePath(projectDir) {
  try {
    const entry = fs.readdirSync(projectDir).find((name) => /^reference-original\./i.test(name));
    return entry ? path.join(projectDir, entry) : null;
  } catch {
    return null;
  }
}

const originalSaveGeneratedAsset = ChatGPTController.prototype.saveGeneratedAsset;
ChatGPTController.prototype.saveGeneratedAsset = async function saveGeneratedAssetWithReferenceFilter(page, source, projectDir) {
  const saved = await originalSaveGeneratedAsset.call(this, page, source, projectDir);
  const referencePath = findReferencePath(projectDir);
  if (referencePath && await isReferenceImage(saved.savePath, referencePath)) {
    fs.rmSync(saved.savePath, { force: true });
    const error = new Error('Captured image matched the uploaded reference image.');
    error.code = 'REFERENCE_IMAGE_FALSE_POSITIVE';
    throw error;
  }
  return saved;
};

const originalCaptureGeneratedImage = ChatGPTController.prototype.captureGeneratedImage;
ChatGPTController.prototype.captureGeneratedImage = async function captureGeneratedImageWithReferenceFilter(page, projectId, baseline, step) {
  for (let attempt = 0; attempt < MAX_NETWORK_REFERENCE_RETRIES; attempt += 1) {
    const result = await originalCaptureGeneratedImage.call(this, page, projectId, baseline, step);

    // The normal DOM capture path is already protected by saveGeneratedAsset above.
    // Only the fast network path bypasses saveGeneratedAsset, so validate that one
    // here without changing the proven waiting/capture behavior.
    if (result?.method !== 'network-response' || !result.path) return result;

    const project = this.projects.read(projectId);
    if (!(await isReferenceImage(result.path, project.referencePath))) return result;

    fs.rmSync(result.path, { force: true });
    if (baseline?.networkObserver?.assets?.length) baseline.networkObserver.assets.shift();

    this.projects.update(projectId, {
      status: 'generating',
      generatedImagePath: null,
      generatedImage: null,
      automationStep: 'Reference image ignored; waiting for generated artwork',
      chatgptError: null
    });
    if (typeof step === 'function') step('Reference image ignored; waiting for generated artwork');
    await wait(300);
  }

  throw new Error('ChatGPT repeatedly returned the uploaded reference image instead of new generated artwork.');
};

module.exports = {
  isReferenceImage,
  visualDifference,
  findReferencePath
};
