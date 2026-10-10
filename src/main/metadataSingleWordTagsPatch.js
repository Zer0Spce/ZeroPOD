const { MetadataController } = require('./metadataController');

const originalBuildPrompt = MetadataController.prototype.buildPrompt;

const REDBUBBLE_BLOCKED_TAGS = new Set([
  'gift', 'gifts', 'art', 'image', 'illustration',
  'shirt', 'tshirt', 'tee', 'tees', 'sticker', 'stickers', 'hoodie', 'apparel',
  'merch', 'merchandise', 'trending', 'cheap', 'sale', 'sales', 'free', 'shipping',
  'bestselling', 'topselling'
]);

function isSingleWordTag(value) {
  const tag = String(value || '').trim();
  if (!tag) return false;
  // One Redbubble tag = one searchable word. No spaces or hyphenated phrases.
  // Unicode letters/numbers are accepted so non-English niche words remain valid.
  return /^[\p{L}\p{N}]+$/u.test(tag);
}

function isAllowedRedbubbleTag(value) {
  const tag = String(value || '').trim().toLowerCase();
  return isSingleWordTag(tag) && !REDBUBBLE_BLOCKED_TAGS.has(tag);
}

MetadataController.prototype.buildPrompt = function buildPromptSingleWordTags(project) {
  let prompt = originalBuildPrompt.call(this, project);

  prompt = prompt
    .replace(
      '- Main Tag: exactly 1 high-intent primary keyword phrase that best describes the design and likely buyer search.',
      '- Main Tag: exactly 1 high-intent SINGLE WORD that best describes the design and likely buyer search. No spaces, hyphens, or phrases.'
    )
    .replace(
      '- Supporting Tags: exactly 14 unique supporting keyword phrases.',
      '- Supporting Tags: exactly 14 unique SINGLE-WORD tags. Every array item must contain one word only; no spaces, hyphens, or phrases.'
    )
    .replace(
      '- Supporting tags should cover closely related niche terms, audience terms, gift/buyer intent, theme, humor/style/occasion terms when genuinely relevant, and useful long-tail variations.',
      '- Supporting tags should be strong individual searchable words covering visible content, theme, style, color, audience, humor, or occasion when genuinely relevant.'
    )
    .replace(
      '- Avoid duplicate tags, near-duplicate tags, keyword stuffing, vague one-word filler, and irrelevant traffic-bait terms.',
      '- Avoid duplicate tags, near-duplicates, keyword stuffing, vague filler, irrelevant traffic-bait terms, product types, brand names, and sales/value buzzwords.'
    )
    .replace(
      '- Exactly 1 mainTag.',
      '- Exactly 1 mainTag, and it must be exactly ONE WORD.'
    )
    .replace(
      '- Exactly 14 supportingTags.',
      '- Exactly 14 supportingTags, and EVERY supporting tag must be exactly ONE WORD.'
    );

  return `${prompt}\n- IMPORTANT: mainTag and every supportingTags item must pass a one-word check: letters/numbers only, with NO spaces or hyphens.\n- REDBUBBLE TAG SAFETY: Do NOT use these tags: gift, gifts, art, image, illustration, shirt, tshirt, tee, tees, sticker, stickers, hoodie, apparel, merch, merchandise, trending, cheap, sale, sales, free, shipping, bestselling, topselling. Prefer specific words that describe the actual artwork, theme, style, palette, character, object, or occasion.`;
};

const originalNormalize = MetadataController.prototype.normalizeMetadataObject;
MetadataController.prototype.normalizeMetadataObject = function normalizeMetadataSingleWordTags(parsed) {
  const metadata = originalNormalize.call(this, parsed);

  if (!isSingleWordTag(metadata.mainTag)) {
    throw new Error(`POD WINNER mainTag must be exactly one word; received "${metadata.mainTag}".`);
  }
  if (!isAllowedRedbubbleTag(metadata.mainTag)) {
    throw new Error(`POD WINNER mainTag is not suitable for Redbubble tagging: "${metadata.mainTag}".`);
  }

  const invalid = metadata.supportingTags.filter((tag) => !isSingleWordTag(tag));
  if (invalid.length) {
    throw new Error(`POD WINNER supportingTags must each be exactly one word; invalid: ${invalid.slice(0, 5).join(', ')}.`);
  }

  const blocked = metadata.supportingTags.filter((tag) => !isAllowedRedbubbleTag(tag));
  if (blocked.length) {
    throw new Error(`POD WINNER supportingTags contain Redbubble low-value/rejected terms: ${blocked.slice(0, 5).join(', ')}.`);
  }

  if (metadata.supportingTags.length !== 14) {
    throw new Error(`POD WINNER metadata needs exactly 14 single-word supporting tags; received ${metadata.supportingTags.length}.`);
  }

  return metadata;
};

MetadataController.prototype.sendRepairRequest = async function sendRepairRequestSingleWord(page, parseError) {
  const repairPrompt = [
    'Fix ONLY your immediately previous metadata response.',
    `Validation problem: ${parseError.message}`,
    'Return ONLY corrected valid JSON using keys title, mainTag, supportingTags, description, optimizationMode.',
    'mainTag must be exactly ONE WORD: no spaces, no hyphens, no phrase.',
    'supportingTags must contain exactly 14 UNIQUE tags and EVERY item must be exactly ONE WORD: no spaces, no hyphens, no phrases.',
    'Do NOT use these tags: gift, gifts, art, image, illustration, shirt, tshirt, tee, tees, sticker, stickers, hoodie, apparel, merch, merchandise, trending, cheap, sale, sales, free, shipping, bestselling, topselling.',
    'Use relevant, specific words that describe the artwork content, theme, style, palette, character, object, or occasion. Avoid filler, product types, brands, and sales/value buzzwords.',
    'optimizationMode must equal exactly "POD WINNER".',
    'No markdown and no commentary.'
  ].join('\n');

  const baseline = await this.assistantSnapshot(page);
  const baselineUsers = await this.userTurnCount(page);
  const composer = await this.chat.fillPrompt(page, repairPrompt);
  await this.chat.sendPrompt(page, composer);
  const submitted = await this.waitForSubmission(page, baselineUsers, repairPrompt.slice(0, 40), 12000);
  if (!submitted) throw new Error('ChatGPT did not submit the automatic metadata repair request.');
  return this.waitForMetadata(page, baseline, 90000);
};

module.exports = { isSingleWordTag, isAllowedRedbubbleTag, REDBUBBLE_BLOCKED_TAGS };
