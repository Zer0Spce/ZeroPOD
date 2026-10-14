const fs = require('fs');
const sharp = require('sharp');
const { feature } = require('./spreadshirtAlphaIpc');
const {
  MARKETPLACE_DESIGNS_URL,
  waitForMarketplaceDesigns
} = require('./spreadshirtMarketplaceRoutePatch');
const freshIdentity = require('./spreadshirtFreshUploadIdentityPatch');
const { perceptualFingerprint } = require('./spreadshirtVisualCardFingerprintPatch');
const { waitForDesignEditor } = require('./spreadshirtVideoFlowPatch');

const previousPrepare = feature.prepare.bind(feature);
const POST_UPLOAD_CARD_ERROR = /returned to Designs after Upload Status|could not verify a genuinely new design card|new design card.*not visible/i;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function isAutomationProject(project) {
  return project?.spreadshirt?.source === 'automation' || project?.automationTargets?.spreadshirt === true;
}

async function artworkHashes(file) {
  if (!file || !fs.existsSync(file)) return new Set();
  const input = fs.readFileSync(file);
  const variants = [input];
  for (const background of ['#ffffff', '#000000']) {
    try {
      variants.push(await sharp(input).ensureAlpha().flatten({ background }).png().toBuffer());
    } catch {}
  }
  const hashes = new Set();
  for (const buffer of variants) {
    const hash = await perceptualFingerprint(buffer).catch(() => null);
    if (hash) hashes.add(hash);
  }
  return hashes;
}

async function openCard(page, card) {
  if (!card) return null;
  if (card.href) {
    await page.goto(card.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  } else {
    const x = card.imageX + Math.max(8, card.imageWidth / 2);
    const y = card.imageY + Math.max(8, card.imageHeight / 2);
    await page.mouse.click(x, y).catch(() => {});
  }

  const started = Date.now();
  while (Date.now() - started < 12000) {
    const match = page.url().match(/\/mp\/designs\/([^/?#]+)/i);
    if (match?.[1]) {
      await waitForDesignEditor(page, 20000).catch(() => {});
      return { designId: match[1], editorUrl: page.url() };
    }
    const text = await page.locator('body').innerText().catch(() => '');
    if (/Design products/i.test(text) && /Metadata|Publish on Spreadshirt/i.test(text)) {
      const id = page.url().match(/\/mp\/designs\/([^/?#]+)/i)?.[1] || null;
      return { designId: id, editorUrl: page.url() };
    }
    await wait(250);
  }
  return null;
}

async function recoverUploadedAutomationDesign(projectId) {
  let project = feature.projects.read(projectId);
  if (!isAutomationProject(project) || project.spreadshirt?.uploadAcceptedAt) return false;
  if (!POST_UPLOAD_CARD_ERROR.test(String(project.spreadshirt?.lastError?.message || ''))) return false;

  const file = project.spreadshirt?.pngPath || project.finalPngPath;
  const expectedHashes = await artworkHashes(file);
  if (!expectedHashes.size) return false;

  const { page } = await feature.sessions.ensureService('spreadshirt');
  if (!/^https:\/\/partner\.spreadshirt\.com\/mp\/designs\/?(?:[?#].*)?$/i.test(page.url())) {
    await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await waitForMarketplaceDesigns(page, 20000);

  let cards = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    cards = await freshIdentity.snapshotMarketplaceCards(page);
    const matching = cards.filter((card) => card.visualHash && expectedHashes.has(card.visualHash));
    if (matching.length) {
      // Spreadshirt inserts new uploads at the front. Limit recovery to the first
      // three cards so an older duplicate artwork cannot silently be selected.
      const candidate = matching
        .map((card) => ({ card, index: cards.indexOf(card) }))
        .filter((entry) => entry.index >= 0 && entry.index <= 2)
        .sort((a, b) => a.index - b.index)[0]?.card;

      if (candidate) {
        activity(projectId, `Automation recovery matched the newly uploaded Spreadshirt artwork on the Designs page${candidate.designId ? ` (${candidate.designId})` : ''}. Reusing it without another upload.`);
        const opened = await openCard(page, candidate);
        if (!opened) return false;

        project = feature.projects.read(projectId);
        feature.projects.update(projectId, {
          spreadshirt: {
            ...(project.spreadshirt || {}),
            status: 'uploaded-draft',
            uploadAcceptedAt: project.spreadshirt?.uploadAcceptedAt || new Date().toISOString(),
            uploadDesignTitle: project.spreadshirt?.uploadDesignTitle || project.spreadshirt?.metadata?.title || null,
            uploadFileName: project.spreadshirt?.uploadFileName || (file ? require('path').basename(file) : null),
            uploadCardHref: candidate.href || opened.editorUrl,
            uploadCardIdentity: candidate.identity || (opened.designId ? `id:${opened.designId}` : null),
            uploadDesignId: opened.designId || candidate.designId || null,
            editorUrl: opened.editorUrl,
            lastError: null,
            automationRecoveredUploadAt: new Date().toISOString()
          }
        });
        return true;
      }
    }

    if (attempt < 3) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await waitForMarketplaceDesigns(page, 15000).catch(() => {});
      await wait(700);
    }
  }

  return false;
}

feature.prepare = async function prepareWithAutomationUploadRecovery(projectId) {
  let project = this.projects.read(projectId);

  // If the previous Automation attempt already uploaded but failed only while
  // identifying the new Designs card, recover that exact artwork BEFORE the
  // normal prepare path gets any chance to upload again.
  if (isAutomationProject(project) && !project.spreadshirt?.uploadAcceptedAt && POST_UPLOAD_CARD_ERROR.test(String(project.spreadshirt?.lastError?.message || ''))) {
    const recovered = await recoverUploadedAutomationDesign(projectId);
    if (recovered) return previousPrepare(projectId);
    throw new Error('Spreadshirt appears to have accepted the previous Automation upload, but ZeroPOD could not safely match it to the current artwork. The existing upload is protected from a duplicate. Open Spreadshirt to inspect it, then Retry.');
  }

  try {
    return await previousPrepare(projectId);
  } catch (error) {
    if (!POST_UPLOAD_CARD_ERROR.test(String(error?.message || error || ''))) throw error;

    project = this.projects.read(projectId);
    if (!isAutomationProject(project) || project.spreadshirt?.uploadAcceptedAt) throw error;

    const recovered = await recoverUploadedAutomationDesign(projectId);
    if (!recovered) throw error;

    activity(projectId, 'Automation recovered the just-uploaded Spreadshirt design after card verification lag. Continuing preparation without re-uploading.');
    return previousPrepare(projectId);
  }
};

module.exports = {
  recoverUploadedAutomationDesign,
  POST_UPLOAD_CARD_ERROR
};
