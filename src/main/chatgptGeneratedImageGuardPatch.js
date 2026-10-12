const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { ChatGPTController } = require('./chatgptController');
const { automationError } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CAPTURE_TIMEOUT_MS = 360000;
const DOM_STABLE_MS = 1200;
const NETWORK_STABLE_MS = 900;
const NETWORK_EARLY_ALLOWANCE_MS = 2000;
const REFERENCE_VISUAL_DIFF_MAX = 7.5;

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

async function normalizedImageDifference(leftInput, rightInput) {
  const [left, right] = await Promise.all([
    normalizedPixels(leftInput),
    normalizedPixels(rightInput)
  ]);
  if (!left.length || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

async function visuallyMatchesReference(candidateBytes, referencePath) {
  if (!candidateBytes?.length || !referencePath || !fs.existsSync(referencePath)) {
    return { match: false, exact: false, difference: Number.POSITIVE_INFINITY };
  }

  const referenceBytes = fs.readFileSync(referencePath);
  if (referenceBytes.length === candidateBytes.length && sha256(referenceBytes) === sha256(candidateBytes)) {
    return { match: true, exact: true, difference: 0 };
  }

  try {
    const difference = await normalizedImageDifference(candidateBytes, referenceBytes);
    return {
      match: Number.isFinite(difference) && difference <= REFERENCE_VISUAL_DIFF_MAX,
      exact: false,
      difference
    };
  } catch {
    return { match: false, exact: false, difference: Number.POSITIVE_INFINITY };
  }
}

async function nonAssistantImageSources(page) {
  const sources = await page.evaluate(() => {
    const values = [];
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || '';
      if (!src) continue;
      const assistant = img.closest('[data-message-author-role="assistant"]');
      if (!assistant) values.push(src);
    }
    return values;
  }).catch(() => []);
  return new Set(sources);
}

async function latestNewAssistantTurn(page, baseline) {
  const messages = page.locator('[data-message-author-role="assistant"]');
  const count = await messages.count();
  if (count <= Number(baseline?.count || 0)) return null;
  return messages.nth(count - 1);
}

async function assistantTurnBusy(page, assistantMessage) {
  const globalStop = await page.locator([
    'button[data-testid="stop-button"]:visible',
    'button[aria-label*="stop generating" i]:visible',
    'button[title*="stop generating" i]:visible'
  ].join(',')).count().catch(() => 0);
  if (globalStop) return true;
  if (!assistantMessage) return true;

  return assistantMessage.evaluate((message) => {
    const turn = message.closest('[data-testid^="conversation-turn-"]') || message.closest('article') || message;
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };

    const busyNode = [...turn.querySelectorAll('[aria-busy="true"], [role="progressbar"], [data-state="loading"], [data-testid*="progress" i], [data-testid*="loading" i]')]
      .some(visible);
    if (busyNode) return true;

    const controls = [...turn.querySelectorAll('button')]
      .filter(visible)
      .map((button) => `${button.innerText || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`)
      .join(' ');
    return /stop generating|cancel generation/i.test(controls);
  }).catch(() => true);
}

async function assistantImageCandidates(assistantMessage, excludedSources) {
  if (!assistantMessage) return [];
  return assistantMessage.evaluate((message, excluded) => {
    const excludedSet = new Set(excluded || []);
    const turn = message.closest('[data-testid^="conversation-turn-"]') || message.closest('article') || message;
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 220 && rect.height >= 220 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };

    const out = [];
    for (const img of turn.querySelectorAll('img')) {
      if (!visible(img)) continue;
      const src = img.currentSrc || img.src || '';
      if (!src || excludedSet.has(src)) continue;
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || 0;
      const height = img.naturalHeight || rect.height || 0;
      if (width < 256 || height < 256) continue;
      const alt = img.alt || '';
      let score = Math.min((width * height) / 1000, 8000);
      if (/generated|create|imagegen|dall/i.test(`${alt} ${src}`)) score += 7000;
      if (/oaiusercontent\.com|imagegen|dall|generated|blob:/i.test(src)) score += 5000;
      if (width >= 768 && height >= 768) score += 3500;
      out.push({ src, width, height, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }, [...excludedSources]).catch(() => []);
}

function formatForNetworkAsset(asset) {
  const format = asset?.format || {};
  if (format.ext && format.mime) return format;
  const sharpFormat = String(asset?.metadata?.format || '').toLowerCase();
  if (sharpFormat === 'jpeg' || sharpFormat === 'jpg') return { ext: '.jpg', mime: 'image/jpeg' };
  if (sharpFormat === 'webp') return { ext: '.webp', mime: 'image/webp' };
  return { ext: '.png', mime: 'image/png' };
}

async function saveNetworkCandidate(controller, projectId, asset, referencePath) {
  const referenceCheck = await visuallyMatchesReference(asset.body, referencePath);
  if (referenceCheck.match) {
    const error = new Error(`Captured network image matches the uploaded reference (${referenceCheck.exact ? 'exact match' : `visual difference ${referenceCheck.difference.toFixed(2)}`}).`);
    error.code = 'REFERENCE_IMAGE_FALSE_POSITIVE';
    throw error;
  }

  const format = formatForNetworkAsset(asset);
  const projectDir = controller.projects.getProjectDir(projectId);
  const savePath = controller.nextDraftPath(projectDir, format.ext);
  fs.writeFileSync(savePath, asset.body);
  try {
    const metadata = await sharp(savePath, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 384 || metadata.height < 384) {
      throw new Error('Captured generated image dimensions were too small.');
    }
    controller.projects.update(projectId, {
      status: 'awaiting-review',
      generatedImagePath: savePath,
      generatedImage: {
        mime: format.mime,
        width: metadata.width,
        height: metadata.height,
        hasAlpha: Boolean(metadata.hasAlpha),
        source: 'guarded-network-response'
      },
      automationStep: 'Ready for review',
      chatgptError: null
    });
    return { ok: true, path: savePath, method: 'guarded-network-response' };
  } catch (error) {
    fs.rmSync(savePath, { force: true });
    throw error;
  }
}

ChatGPTController.prototype.captureGeneratedImage = async function captureGeneratedImageGuarded(page, projectId, baseline, step) {
  const project = this.projects.read(projectId);
  const referencePath = project.referencePath;
  const observer = baseline?.networkObserver;
  const excludedSources = new Set([
    ...[...(baseline?.imageSources || [])],
    ...[...(baseline?.allImageSources || [])]
  ]);

  // Capture the sent user/reference images separately. Only non-assistant images
  // are added here, so a very fast genuine assistant generation is never excluded.
  await wait(220);
  for (const source of await nonAssistantImageSources(page)) excludedSources.add(source);

  step('Waiting for a new ChatGPT assistant response');
  await this.waitForNewAssistantResponse(page, baseline, step);
  const assistantSeenAt = Date.now();
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  const stableDom = new Map();
  let lastError = null;
  let lastProgress = 0;
  let warnedReference = false;

  while (Date.now() < deadline) {
    await this.assertNoHumanGate(page);
    const assistantMessage = await latestNewAssistantTurn(page, baseline);
    const busy = await assistantTurnBusy(page, assistantMessage);

    // Network capture stays fast, but it is no longer allowed to win merely because
    // an uploaded reference thumbnail finished loading after Send. The candidate must
    // belong to the new-response time window, survive a short settle period, and not
    // match the actual reference image bytes/appearance.
    if (!busy && observer?.assets?.length) {
      while (observer.assets.length) {
        const asset = observer.assets[0];
        if (!asset) break;
        if (asset.at < assistantSeenAt - NETWORK_EARLY_ALLOWANCE_MS) {
          observer.assets.shift();
          continue;
        }
        if (excludedSources.has(asset.url)) {
          observer.assets.shift();
          continue;
        }
        if (Date.now() - asset.at < NETWORK_STABLE_MS) break;

        try {
          const saved = await saveNetworkCandidate(this, projectId, asset, referencePath);
          step('Generated image verified');
          step('Ready for review');
          return saved;
        } catch (error) {
          lastError = error;
          observer.assets.shift();
          if (error.code === 'REFERENCE_IMAGE_FALSE_POSITIVE') {
            warnedReference = true;
            step('Reference image ignored; waiting for generated artwork');
          }
        }
      }
    }

    // DOM fallback is intentionally restricted to the NEW ASSISTANT turn. User
    // attachments/reference previews can never be accepted from this path.
    if (!busy && assistantMessage) {
      const candidates = await assistantImageCandidates(assistantMessage, excludedSources);
      for (const candidate of candidates) {
        const now = Date.now();
        const seen = stableDom.get(candidate.src) || { firstSeen: now, count: 0 };
        seen.count += 1;
        stableDom.set(candidate.src, seen);
        if (seen.count < 2 || now - seen.firstSeen < DOM_STABLE_MS) continue;

        try {
          const saved = await this.saveGeneratedAsset(page, candidate.src, this.projects.getProjectDir(projectId));
          const savedBytes = fs.readFileSync(saved.savePath);
          const referenceCheck = await visuallyMatchesReference(savedBytes, referencePath);
          if (referenceCheck.match) {
            fs.rmSync(saved.savePath, { force: true });
            excludedSources.add(candidate.src);
            warnedReference = true;
            step('Reference image ignored; waiting for generated artwork');
            continue;
          }

          this.projects.update(projectId, {
            status: 'awaiting-review',
            generatedImagePath: saved.savePath,
            generatedImage: {
              mime: saved.mime,
              width: saved.metadata.width,
              height: saved.metadata.height,
              hasAlpha: Boolean(saved.metadata.hasAlpha),
              source: candidate.src.startsWith('blob:') ? 'guarded-assistant-blob' : 'guarded-assistant-image'
            },
            automationStep: 'Ready for review',
            chatgptError: null
          });
          step('Generated image verified');
          step('Ready for review');
          return { ok: true, path: saved.savePath, method: 'guarded-assistant-image' };
        } catch (error) {
          lastError = error;
        }
      }
    }

    if (Date.now() - lastProgress > 3000) {
      step(busy ? 'ChatGPT is still generating the image' : 'Waiting for final generated artwork');
      lastProgress = Date.now();
    }
    await wait(320);
  }

  const error = new Error(
    warnedReference
      ? 'ChatGPT did not expose a verified new generated image within 6 minutes. ZeroPOD rejected the uploaded reference image instead of using it as the result.'
      : `ChatGPT did not expose a verified generated image within 6 minutes${lastError ? `: ${lastError.message}` : '.'}`
  );
  this.projects.update(projectId, {
    status: 'chatgpt-recovery-needed',
    automationStep: 'Generated image capture needs attention',
    chatgptError: automationError(
      'chatgpt',
      'capture-generated-image',
      error,
      'Keep the completed ChatGPT generation open, then Retry. ZeroPOD now accepts only a new assistant-generated image and rejects the uploaded reference image.'
    )
  });
  throw error;
};

module.exports = {
  normalizedImageDifference,
  visuallyMatchesReference,
  REFERENCE_VISUAL_DIFF_MAX
};
