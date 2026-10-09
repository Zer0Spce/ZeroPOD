const { MetadataController } = require('./metadataController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const originalAssistantSnapshot = MetadataController.prototype.assistantSnapshot;
const originalConsumeVisibleMetadata = MetadataController.prototype.consumeVisibleMetadata;

function metadataFingerprint(metadata) {
  return JSON.stringify({
    title: metadata.title,
    mainTag: metadata.mainTag,
    supportingTags: metadata.supportingTags,
    description: metadata.description,
    optimizationMode: metadata.optimizationMode
  });
}

function extractValidMetadataCandidates(controller, rawText) {
  const objects = controller.extractJSONObjects(String(rawText || ''));
  const candidates = [];

  for (const raw of objects) {
    try {
      const parsed = JSON.parse(raw);
      const metadata = controller.normalizeMetadataObject(parsed);
      candidates.push({ metadata, raw, fingerprint: metadataFingerprint(metadata) });
    } catch {}
  }

  return candidates;
}

async function visibleConversationText(page) {
  // Do not depend on ChatGPT's message-role wrappers. They change regularly.
  // Prefer the conversation main element, then fall back to the full visible page.
  const mainText = await page.locator('main').innerText({ timeout: 1200 }).catch(() => '');
  if (mainText && /\{[\s\S]*"(?:title|mainTag|supportingTags)"/i.test(mainText)) return mainText;

  return page.locator('body').innerText({ timeout: 1200 }).catch(() => mainText || '');
}

async function visibleMetadataState(controller, page) {
  const text = await visibleConversationText(page);
  const candidates = extractValidMetadataCandidates(controller, text);
  const counts = {};

  for (const candidate of candidates) {
    counts[candidate.fingerprint] = (counts[candidate.fingerprint] || 0) + 1;
  }

  return {
    textLength: text.length,
    counts,
    candidates
  };
}

MetadataController.prototype.assistantSnapshot = async function assistantSnapshotWithVisibleMetadata(page) {
  const base = await originalAssistantSnapshot.call(this, page).catch(() => ({ count: 0, lastText: '' }));
  const visible = await visibleMetadataState(this, page);
  return {
    ...base,
    visibleMetadataCounts: visible.counts,
    visibleTextLength: visible.textLength
  };
};

MetadataController.prototype.consumeVisibleMetadata = async function consumeVisibleMetadataAnywhere(page) {
  const visible = await visibleMetadataState(this, page);
  if (visible.candidates.length) {
    const newest = visible.candidates[visible.candidates.length - 1];
    return { metadata: newest.metadata, raw: newest.raw };
  }

  // Retain the older scoped reader as a secondary path for future UI variants.
  return originalConsumeVisibleMetadata.call(this, page).catch(() => null);
};

MetadataController.prototype.waitForMetadata = async function waitForMetadataVisibleJSON(page, baseline = {}, timeoutMs = 180000) {
  const started = Date.now();
  const baselineCounts = baseline.visibleMetadataCounts || {};
  let lastTextLength = baseline.visibleTextLength || 0;
  let sawConversationChange = false;

  while (Date.now() - started < timeoutMs) {
    const visible = await visibleMetadataState(this, page);

    // Accept only a metadata object whose occurrence count increased after Send.
    // This prevents an older project's JSON in the reused thread from being read
    // as the response for the current project. Identical metadata repeated by
    // ChatGPT is still accepted because its occurrence count increases.
    for (let index = visible.candidates.length - 1; index >= 0; index -= 1) {
      const candidate = visible.candidates[index];
      const before = Number(baselineCounts[candidate.fingerprint] || 0);
      const now = Number(visible.counts[candidate.fingerprint] || 0);
      if (now > before) return { metadata: candidate.metadata, raw: candidate.raw };
    }

    if (visible.textLength !== lastTextLength) {
      sawConversationChange = true;
      lastTextLength = visible.textLength;
    }

    await wait(250);
  }

  // One final scan handles a response that landed exactly at timeout.
  const visible = await visibleMetadataState(this, page);
  for (let index = visible.candidates.length - 1; index >= 0; index -= 1) {
    const candidate = visible.candidates[index];
    if (Number(visible.counts[candidate.fingerprint] || 0) > Number(baselineCounts[candidate.fingerprint] || 0)) {
      return { metadata: candidate.metadata, raw: candidate.raw };
    }
  }

  throw new Error(sawConversationChange
    ? 'ChatGPT responded, but ZeroPOD could not find a new valid POD WINNER JSON object with 14 unique supporting tags in the visible conversation.'
    : 'Timed out waiting for ChatGPT metadata response.');
};

module.exports = {
  extractValidMetadataCandidates,
  metadataFingerprint
};
