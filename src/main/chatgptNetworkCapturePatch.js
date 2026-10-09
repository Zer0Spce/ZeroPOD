const fs = require('fs');
const sharp = require('sharp');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const observers = new WeakMap();

function sniffImage(buffer, contentType = '') {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  if (/image\/png/i.test(contentType)) return { ext: '.png', mime: 'image/png' };
  if (/image\/jpe?g/i.test(contentType)) return { ext: '.jpg', mime: 'image/jpeg' };
  if (/image\/webp/i.test(contentType)) return { ext: '.webp', mime: 'image/webp' };
  return null;
}

function responseScore(url, metadata, bytes) {
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const area = width * height;
  const ratio = height ? width / height : 0;
  let score = Math.min(area / 1000, 12000) + Math.min(bytes / 1000, 6000);
  if (/oaiusercontent\.com|backend-api|imagegen|dall|generated|file/i.test(url || '')) score += 12000;
  if (width >= 768 && height >= 768) score += 7000;
  if (ratio && Math.abs(ratio - 0.8) <= 0.08) score += 5000;
  return score;
}

function installObserver(page) {
  let observer = observers.get(page);
  if (observer) return observer;
  observer = { assets: [], generationStartedAt: 0, seen: new Set() };
  const onResponse = async (response) => {
    try {
      if (!observer.generationStartedAt) return;
      const url = response.url();
      if (observer.seen.has(url)) return;
      const headers = response.headers();
      const contentType = headers['content-type'] || '';
      const likelyImage = /^image\//i.test(contentType) || /oaiusercontent\.com|backend-api.*(?:file|image)|imagegen|dall/i.test(url);
      if (!likelyImage || response.status() < 200 || response.status() >= 300) return;
      const body = await response.body().catch(() => null);
      if (!body || body.length < 50000) return;
      const format = sniffImage(body, contentType);
      if (!format) return;
      const metadata = await sharp(body, { failOn: 'error' }).metadata().catch(() => null);
      if (!metadata?.width || !metadata?.height || metadata.width < 384 || metadata.height < 384) return;
      observer.seen.add(url);
      observer.assets.push({ url, body, format, metadata, score: responseScore(url, metadata, body.length), at: Date.now() });
      observer.assets.sort((a, b) => b.score - a.score);
      observer.assets = observer.assets.slice(0, 12);
    } catch {}
  };
  page.on('response', onResponse);
  observer.dispose = () => page.off('response', onResponse);
  observers.set(page, observer);
  page.once('close', observer.dispose);
  return observer;
}

const originalSnapshot = ChatGPTController.prototype.snapshotAssistantState;
ChatGPTController.prototype.snapshotAssistantState = async function snapshotAssistantStateWithNetwork(page) {
  const observer = installObserver(page);
  observer.assets = [];
  observer.seen.clear();
  observer.generationStartedAt = 0;
  const baseline = await originalSnapshot.call(this, page);
  return { ...baseline, networkObserver: observer };
};

const originalSendPrompt = ChatGPTController.prototype.sendPrompt;
ChatGPTController.prototype.sendPrompt = async function sendPromptWithNetworkCapture(page, composer) {
  const observer = installObserver(page);
  observer.assets = [];
  observer.seen.clear();
  const result = await originalSendPrompt.call(this, page, composer);
  observer.generationStartedAt = Date.now();
  return result;
};

async function saveNetworkAsset(controller, projectId, asset) {
  const projectDir = controller.projects.getProjectDir(projectId);
  const savePath = controller.nextDraftPath(projectDir, asset.format.ext);
  fs.writeFileSync(savePath, asset.body);
  try {
    const metadata = await sharp(savePath, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 384 || metadata.height < 384) throw new Error('Captured network image dimensions were too small.');
    controller.projects.update(projectId, {
      status: 'awaiting-review',
      generatedImagePath: savePath,
      generatedImage: {
        mime: asset.format.mime,
        width: metadata.width,
        height: metadata.height,
        hasAlpha: Boolean(metadata.hasAlpha),
        source: 'network-response'
      },
      automationStep: 'Ready for review',
      chatgptError: null
    });
    return { ok: true, path: savePath, method: 'network-response' };
  } catch (error) {
    fs.rmSync(savePath, { force: true });
    throw error;
  }
}

const originalCapture = ChatGPTController.prototype.captureGeneratedImage;
ChatGPTController.prototype.captureGeneratedImage = async function captureGeneratedImageNetworkFirst(page, projectId, baseline, step) {
  const observer = baseline?.networkObserver || installObserver(page);
  const networkDeadline = Date.now() + 45000;
  step('Waiting for ChatGPT response');

  // Network capture is the primary path. It ignores ChatGPT's temporary UUID
  // download filename and saves the actual PNG/JPEG/WebP bytes under our own name.
  while (Date.now() < networkDeadline) {
    await this.assertNoHumanGate(page);
    const asset = observer.assets[0];
    if (asset) {
      try {
        step('Generated image detected');
        step('Saving generated image');
        const saved = await saveNetworkAsset(this, projectId, asset);
        step('Ready for review');
        return saved;
      } catch {
        observer.assets.shift();
      }
    }
    await wait(250);
  }

  // DOM/source capture remains as a compatibility fallback if ChatGPT changes
  // which responses expose the final image bytes.
  return originalCapture.call(this, page, projectId, baseline, step);
};
