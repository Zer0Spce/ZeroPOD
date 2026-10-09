const fs = require('fs');
const { ChatGPTController } = require('./chatgptController');
const { automationError } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MetadataController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;

    // Metadata deliberately reuses the exact ChatGPT transport used by image
    // generation. There is no metadata-specific upload/paste/send implementation.
    // This keeps one proven browser path for composer readiness, image attachment,
    // prompt insertion, send readiness, Chrome profile handling, and thread reuse.
    this.chat = new ChatGPTController({ sessions, projects, podRules: [] });
  }

  buildPrompt(project) {
    if (!project.sourceUrl) throw new Error('POD WINNER metadata requires the pasted Amazon/source link.');

    return [
      'POD WINNER MODE',
      'Create SEO-ready Redbubble listing metadata for the APPROVED POD DESIGN attached to this message.',
      '',
      'PRIMARY RESEARCH SOURCE:',
      `Amazon reference URL: ${project.sourceUrl}`,
      '',
      'Use the attached approved design as the source of truth for what the artwork actually says and shows.',
      'Use the pasted Amazon link as the PRIMARY niche and buyer-intent reference.',
      'Analyze the niche, target audience, likely search language, gift intent, emotional angle, product theme, and commercially useful generic keywords from that reference.',
      'Do NOT copy the Amazon listing title or description verbatim.',
      'Do NOT include Amazon brand names, seller names, copyrighted character names, protected brand names, or trademarked phrases simply because they appear on the source page.',
      'Use the Amazon listing for market/niche context, then write original metadata for this approved ZeroPOD design.',
      '',
      'Return ONLY valid JSON. No markdown, no code fences, no commentary.',
      'Use exactly this schema:',
      '{',
      '  "title": "...",',
      '  "mainTag": "...",',
      '  "supportingTags": ["..."],',
      '  "description": "...",',
      '  "optimizationMode": "POD WINNER"',
      '}',
      '',
      'SEO REQUIREMENTS:',
      '- Title: original, descriptive, natural, buyer-friendly, and centered on the strongest niche/search phrase.',
      '- Put the strongest relevant keyword naturally near the beginning of the title when it reads well.',
      '- Main Tag: exactly 1 high-intent primary keyword phrase that best describes the design and likely buyer search.',
      '- Supporting Tags: exactly 14 unique supporting keyword phrases.',
      '- Supporting tags should cover closely related niche terms, audience terms, gift/buyer intent, theme, humor/style/occasion terms when genuinely relevant, and useful long-tail variations.',
      '- Avoid duplicate tags, near-duplicate tags, keyword stuffing, vague one-word filler, and irrelevant traffic-bait terms.',
      '- Description: short, natural, persuasive, and readable; explain what the design is and who it is for while naturally using the main niche language.',
      '- Metadata must describe the APPROVED DESIGN, not merely the Amazon product.',
      '- Keep everything search-friendly but human-readable.',
      '- Never promise rankings, sales, bestseller status, or guaranteed performance.',
      '- Avoid brand/trademark names unless they are clearly generic and safe to use.',
      '',
      'QUALITY CHECK BEFORE RESPONDING:',
      '- Exactly 1 mainTag.',
      '- Exactly 14 supportingTags.',
      '- No duplicates ignoring capitalization/plurals.',
      '- Title, tags, and description all match the attached approved design and the Amazon-derived niche.',
      '- optimizationMode must equal exactly "POD WINNER".',
      '',
      'Produce the final metadata now.'
    ].join('\n');
  }

  normalizeTag(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  canonicalTag(value) {
    return this.normalizeTag(value)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractJSONObjects(raw) {
    const text = String(raw || '').replace(/^\uFEFF/, '');
    const objects = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          objects.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return objects;
  }

  normalizeMetadataObject(parsed) {
    if (!parsed || typeof parsed !== 'object') throw new Error('Metadata response is not an object.');

    const title = parsed.title ?? parsed.Title ?? parsed.name;
    const mainTag = parsed.mainTag ?? parsed.main_tag ?? parsed.primaryTag ?? parsed.primary_tag;
    const tags = parsed.supportingTags ?? parsed.supporting_tags ?? parsed.tags;
    const description = parsed.description ?? parsed.shortDescription ?? parsed.short_description;

    if (!title || !mainTag || !description || !Array.isArray(tags)) {
      throw new Error('Metadata response is missing Title, Main Tag, Supporting Tags, or Description.');
    }

    const normalizedMain = this.normalizeTag(mainTag);
    const mainKey = this.canonicalTag(normalizedMain);
    const seen = new Set();
    const uniqueTags = [];

    for (const rawTag of tags) {
      const tag = this.normalizeTag(rawTag);
      const key = this.canonicalTag(tag);
      if (!tag || !key || key === mainKey || seen.has(key)) continue;
      seen.add(key);
      uniqueTags.push(tag);
    }

    if (uniqueTags.length < 14) {
      throw new Error(`POD WINNER metadata needs 14 unique supporting tags; ChatGPT returned ${uniqueTags.length}.`);
    }

    return {
      title: String(title).trim(),
      mainTag: normalizedMain,
      supportingTags: uniqueTags.slice(0, 14),
      description: String(description).trim(),
      optimizationMode: 'POD WINNER'
    };
  }

  parseMetadata(raw) {
    let text = String(raw || '').trim();
    if (!text) throw new Error('ChatGPT metadata response was empty.');

    text = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const candidates = this.extractJSONObjects(text);
    if (!candidates.length) throw new Error('ChatGPT did not return a JSON metadata object.');

    let lastError = null;
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      try {
        return this.normalizeMetadataObject(JSON.parse(candidates[i]));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('ChatGPT metadata JSON could not be parsed.');
  }

  async userTurnCount(page) {
    return page.locator('[data-message-author-role="user"], [data-turn="user"], [data-conversation-role="user"]').count().catch(() => 0);
  }

  async assistantSnapshot(page) {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    const count = await assistants.count().catch(() => 0);
    const lastText = count ? (await assistants.nth(count - 1).innerText().catch(() => '')).trim() : '';
    return { count, lastText };
  }

  async newestAssistantPayload(page) {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    const count = await assistants.count().catch(() => 0);
    if (!count) return { count: 0, text: '', code: '' };

    const newest = assistants.nth(count - 1);
    return {
      count,
      text: (await newest.innerText().catch(() => '')).trim(),
      code: (await newest.locator('pre, code').allInnerTexts().catch(() => [])).join('\n').trim()
    };
  }

  async latestUserText(page) {
    const users = page.locator('[data-message-author-role="user"], [data-turn="user"], [data-conversation-role="user"]');
    const count = await users.count().catch(() => 0);
    if (!count) return '';
    return (await users.nth(count - 1).innerText().catch(() => '')).trim();
  }

  isMetadataRequest(text) {
    return /POD WINNER MODE|Create SEO-ready Redbubble listing metadata|Produce the final metadata now/i.test(String(text || ''));
  }

  async consumeVisibleMetadata(page) {
    const userText = await this.latestUserText(page);
    if (!this.isMetadataRequest(userText)) return null;

    const newest = await this.newestAssistantPayload(page);
    for (const raw of [newest.text, newest.code]) {
      if (!raw) continue;
      try {
        return { metadata: this.parseMetadata(raw), raw };
      } catch {}
    }

    // Last-resort recovery for ChatGPT wrapper changes. This is safe only when the
    // newest user message is a metadata request; the prompt schema itself cannot
    // pass the 14-real-tag validation above.
    const conversation = await page.locator('main').innerText().catch(() => '');
    if (conversation) {
      try {
        return { metadata: this.parseMetadata(conversation), raw: conversation };
      } catch {}
    }
    return null;
  }

  async waitForSubmission(page, baselineUserCount, promptStart, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const userCount = await this.userTurnCount(page);
      if (userCount > baselineUserCount) return true;

      const composer = this.chat.composerLocator(page);
      const composerVisible = await composer.isVisible().catch(() => false);
      if (composerVisible) {
        const text = await composer.evaluate((element) => {
          if ('value' in element) return String(element.value || '');
          return String(element.innerText || element.textContent || '');
        }).catch(() => '');
        if (!text.includes(promptStart)) return true;
      }

      const stopVisible = await page.locator('button[data-testid="stop-button"], button[aria-label*="stop" i], button[data-testid*="stop" i]').first().isVisible().catch(() => false);
      if (stopVisible) return true;
      await wait(150);
    }
    return false;
  }

  async rememberCurrentThread(page) {
    const started = Date.now();
    while (Date.now() - started < 7000) {
      const current = page.url();
      if (/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{20,}$/i.test(current)) {
        this.sessions.rememberThreadUrl('chatgpt', current);
        return current;
      }
      await wait(150);
    }
    return null;
  }

  async waitForMetadata(page, baseline, timeoutMs = 180000) {
    const started = Date.now();
    let latest = '';
    let lastChangeAt = Date.now();
    let sawResponse = false;

    while (Date.now() - started < timeoutMs) {
      const newest = await this.newestAssistantPayload(page);
      const changed = newest.count > baseline.count || (newest.text && newest.text !== baseline.lastText);

      if (changed) {
        sawResponse = true;
        if (newest.text !== latest) {
          latest = newest.text;
          lastChangeAt = Date.now();
        }

        for (const raw of [newest.text, newest.code]) {
          if (!raw) continue;
          try {
            return { metadata: this.parseMetadata(raw), raw };
          } catch {}
        }

        const stopVisible = await page.locator('button[data-testid="stop-button"], button[aria-label*="stop" i], button[data-testid*="stop" i]').first().isVisible().catch(() => false);
        if (!stopVisible && latest && Date.now() - lastChangeAt > 2200) {
          // Response is stable and finished. Keep polling a little longer because
          // ChatGPT sometimes updates the final JSON wrapper after text settles.
          const visible = await this.consumeVisibleMetadata(page);
          if (visible?.metadata) return visible;
        }
      }
      await wait(250);
    }

    const visible = await this.consumeVisibleMetadata(page);
    if (visible?.metadata) return visible;

    const error = new Error(sawResponse
      ? 'ChatGPT responded, but the latest metadata response was not valid POD WINNER JSON with 14 unique supporting tags.'
      : 'Timed out waiting for ChatGPT metadata response.');
    error.raw = latest;
    throw error;
  }

  async sendRepairRequest(page, parseError) {
    const repairPrompt = [
      'Fix ONLY your immediately previous metadata response.',
      `Validation problem: ${parseError.message}`,
      'Return ONLY corrected valid JSON using keys title, mainTag, supportingTags, description, optimizationMode.',
      'supportingTags must contain exactly 14 unique useful phrases and optimizationMode must be "POD WINNER".',
      'No markdown and no commentary.'
    ].join('\n');

    const baseline = await this.assistantSnapshot(page);
    const baselineUsers = await this.userTurnCount(page);
    const composer = await this.chat.fillPrompt(page, repairPrompt);
    await this.chat.sendPrompt(page, composer);
    const submitted = await this.waitForSubmission(page, baselineUsers, repairPrompt.slice(0, 40), 12000);
    if (!submitted) throw new Error('ChatGPT did not submit the automatic metadata repair request.');
    return this.waitForMetadata(page, baseline, 90000);
  }

  saveMetadata(projectId, project, metadata) {
    const approvedPath = project.approvedImagePath || project.generatedImagePath;
    const updated = this.projects.update(projectId, {
      status: 'metadata-ready',
      metadata,
      metadataMode: 'POD WINNER',
      metadataSourceUrl: project.sourceUrl,
      metadataGroundedImagePath: approvedPath,
      metadataError: null
    });
    return { ok: true, metadata, project: updated };
  }

  async generate(projectId) {
    const project = this.projects.read(projectId);
    if (!['approved-image', 'metadata-ready', 'metadata-recovery-needed'].includes(project.status)) {
      throw new Error('Image must pass review before generating metadata.');
    }
    if (!project.sourceUrl) throw new Error('Paste the Amazon/source link before generating POD WINNER metadata.');

    const approvedPath = project.approvedImagePath || project.generatedImagePath;
    if (!approvedPath || !fs.existsSync(approvedPath)) throw new Error('Approved design image is missing.');

    try {
      const { page } = await this.sessions.ensureService('chatgpt');
      await page.bringToFront();

      // Use the same remembered-thread behavior as normal design generation.
      await this.chat.openPreferredThread(page);
      await this.chat.ensureReady(page);

      // Recovery first: if an older beta already produced valid JSON, consume it
      // without attaching another image or sending another prompt.
      if (project.status === 'metadata-recovery-needed') {
        const existing = await this.consumeVisibleMetadata(page);
        if (existing?.metadata) return this.saveMetadata(projectId, project, existing.metadata);
      }

      this.projects.update(projectId, { status: 'metadata-generating', metadataError: null });

      const baselineAssistant = await this.assistantSnapshot(page);
      const baselineUsers = await this.userTurnCount(page);
      const prompt = this.buildPrompt(project);

      // IMPORTANT: these are the exact same patched methods used by successful
      // image-generation runs. Metadata no longer owns a second automation stack.
      await this.chat.attachReference(page, approvedPath);
      const composer = await this.chat.fillPrompt(page, prompt);
      await this.chat.sendPrompt(page, composer);

      const submitted = await this.waitForSubmission(page, baselineUsers, prompt.slice(0, 40), 15000);
      if (!submitted) {
        throw new Error('The shared ChatGPT generation transport returned without submitting the metadata prompt. The prompt was left visible and no response was consumed.');
      }

      await this.rememberCurrentThread(page);

      try {
        const result = await this.waitForMetadata(page, baselineAssistant);
        return this.saveMetadata(projectId, project, result.metadata);
      } catch (parseError) {
        // One automatic correction is allowed only after ChatGPT actually responded.
        // This handles 13 tags, duplicate tags, wrapper text, or malformed JSON.
        if (/responded|14 unique|JSON|metadata response/i.test(parseError.message)) {
          const repaired = await this.sendRepairRequest(page, parseError);
          return this.saveMetadata(projectId, project, repaired.metadata);
        }
        throw parseError;
      }
    } catch (error) {
      const recovery = automationError(
        'chatgpt',
        'metadata',
        error,
        'Keep the current ChatGPT thread open and press Retry Metadata. ZeroPOD will first consume valid JSON already visible, then use the same ChatGPT transport as normal image generation.'
      );
      this.projects.update(projectId, { status: 'metadata-recovery-needed', metadataError: recovery });
      throw new Error(recovery.message);
    }
  }
}

module.exports = { MetadataController };
