const fs = require('fs');
const { retryStep, clickFirstVisible, automationError } = require('./automationUtils');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MetadataController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
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
      'Schema:',
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

  async locateComposer(page) {
    const selectors = ['#prompt-textarea', '[data-testid="composer-text-input"]', 'textarea[placeholder*="Message"]', 'textarea', '[contenteditable="true"][data-placeholder]', '[contenteditable="true"]'];
    return retryStep('Locate ChatGPT metadata composer', async () => {
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
          await locator.waitFor({ state: 'visible', timeout: 1200 });
          return locator;
        } catch {}
      }
      throw new Error('Could not find the ChatGPT composer.');
    }, { attempts: 3, delayMs: 350 });
  }

  async attachApprovedDesign(page, project) {
    const approvedPath = project.generatedImagePath;
    if (!approvedPath || !fs.existsSync(approvedPath)) throw new Error('Approved design image is missing. Re-open the project review and restore the generated image before metadata generation.');

    return retryStep('Attach approved design for metadata', async () => {
      let input = page.locator('input[type="file"][accept*="image" i]').first();
      if (!(await input.count())) input = page.locator('input[type="file"]').first();
      if (!(await input.count())) {
        await clickFirstVisible([
          page.locator('button[data-testid="composer-plus-btn"]').first(),
          page.getByRole('button', { name: /attach|upload|add photos|add files|add/i }).first(),
          page.locator('button[aria-label*="attach" i]').first(),
          page.locator('button[aria-label*="upload" i]').first()
        ], { timeout: 1200 });
        await page.waitForTimeout(250);
        input = page.locator('input[type="file"]').first();
      }
      if (!(await input.count())) throw new Error('Could not find ChatGPT image upload input for metadata grounding.');

      const buffer = fs.readFileSync(approvedPath);
      await input.setInputFiles({
        name: `approved-design${approvedPath.toLowerCase().endsWith('.jpg') || approvedPath.toLowerCase().endsWith('.jpeg') ? '.jpg' : approvedPath.toLowerCase().endsWith('.webp') ? '.webp' : '.png'}`,
        mimeType: approvedPath.toLowerCase().endsWith('.jpg') || approvedPath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : approvedPath.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/png',
        buffer
      }, { timeout: 5000 });
      return true;
    }, { attempts: 2, delayMs: 350 });
  }

  normalizeTag(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  canonicalTag(value) {
    return this.normalizeTag(value).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(s|es)\b/g, '').trim();
  }

  extractJSONObject(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/^\uFEFF/, '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const first = text.indexOf('{');
    if (first < 0) throw new Error('ChatGPT did not return JSON metadata.');

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = first; i < text.length; i += 1) {
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
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(first, i + 1);
      }
    }

    throw new Error('ChatGPT metadata JSON is incomplete.');
  }

  parseMetadata(raw) {
    const jsonText = this.extractJSONObject(raw);
    const parsed = JSON.parse(jsonText);
    if (!parsed.title || !parsed.mainTag || !parsed.description || !Array.isArray(parsed.supportingTags)) {
      throw new Error('Metadata response is missing required fields.');
    }

    parsed.title = String(parsed.title).trim();
    parsed.mainTag = this.normalizeTag(parsed.mainTag);
    parsed.description = String(parsed.description).trim();
    parsed.optimizationMode = 'POD WINNER';
    parsed.supportingTags = parsed.supportingTags.map((tag) => this.normalizeTag(tag)).filter(Boolean);

    const seen = new Set();
    const uniqueTags = [];
    for (const tag of parsed.supportingTags) {
      const key = this.canonicalTag(tag);
      if (!key || seen.has(key) || key === this.canonicalTag(parsed.mainTag)) continue;
      seen.add(key);
      uniqueTags.push(tag);
    }

    parsed.supportingTags = uniqueTags.slice(0, 14);
    if (parsed.supportingTags.length !== 14) throw new Error('POD WINNER metadata must contain exactly 14 unique supporting tags.');
    return parsed;
  }

  async composerText(composer) {
    return composer.evaluate((element) => {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || '';
      return element.innerText || element.textContent || '';
    }).catch(() => '');
  }

  async submitPrompt(page, prompt) {
    const composer = await this.locateComposer(page);
    await composer.click();
    await composer.press('Control+A').catch(() => {});
    await composer.press('Backspace').catch(() => {});
    await page.keyboard.insertText(prompt);

    const inserted = await this.composerText(composer);
    if (!inserted.includes(prompt.slice(0, Math.min(60, prompt.length)))) {
      throw new Error('ChatGPT metadata prompt was not inserted into the composer.');
    }

    const sent = await clickFirstVisible([
      page.locator('button[data-testid="send-button"]:visible').first(),
      page.locator('button[data-testid*="send" i]:visible').first(),
      page.getByRole('button', { name: /send/i }).first(),
      page.locator('button[aria-label*="send" i]:visible').first()
    ], { timeout: 2500 });
    if (!sent) await composer.press('Enter');
  }

  async snapshotAssistant(page) {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    const count = await assistants.count();
    const lastText = count ? (await assistants.nth(count - 1).innerText().catch(() => '')).trim() : '';
    return { count, lastText };
  }

  async parseLatestVisibleAssistant(page, maxMessages = 3) {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    const count = await assistants.count();
    for (let offset = 0; offset < Math.min(maxMessages, count); offset += 1) {
      const text = (await assistants.nth(count - 1 - offset).innerText().catch(() => '')).trim();
      if (!text) continue;
      try {
        return { metadata: this.parseMetadata(text), raw: text };
      } catch {}
    }
    return null;
  }

  async waitForAssistantMetadata(page, baseline, timeoutMs = 180000) {
    const started = Date.now();
    let latestText = '';
    let lastChangeAt = Date.now();
    let sawNewResponse = false;

    while (Date.now() - started < timeoutMs) {
      const assistants = page.locator('[data-message-author-role="assistant"]');
      const count = await assistants.count();
      if (count) {
        const text = (await assistants.nth(count - 1).innerText().catch(() => '')).trim();
        const changedFromBaseline = count > baseline.count || (text && text !== baseline.lastText);
        if (changedFromBaseline) {
          sawNewResponse = true;
          if (text !== latestText) {
            latestText = text;
            lastChangeAt = Date.now();
          }
          if (text) {
            try {
              return { metadata: this.parseMetadata(text), raw: text };
            } catch (error) {
              // While ChatGPT is streaming, incomplete JSON is expected. Once the
              // visible response has stopped changing for a few seconds, surface
              // the real parse error so the correction prompt can run promptly.
              if (Date.now() - lastChangeAt > 3500 && /\}/.test(text)) {
                const parseError = new Error(error.message || 'Visible ChatGPT metadata could not be parsed.');
                parseError.raw = text;
                throw parseError;
              }
            }
          }
        }
      }
      await wait(250);
    }

    const error = new Error(sawNewResponse
      ? 'ChatGPT returned metadata text, but ZeroPOD could not parse it before the timeout.'
      : 'Timed out waiting for ChatGPT metadata response.');
    error.raw = latestText;
    throw error;
  }

  saveMetadata(projectId, project, metadata) {
    const updated = this.projects.update(projectId, {
      status: 'metadata-ready',
      metadata,
      metadataMode: 'POD WINNER',
      metadataSourceUrl: project.sourceUrl,
      metadataGroundedImagePath: project.generatedImagePath,
      metadataError: null
    });
    return { ok: true, metadata, project: updated };
  }

  async generate(projectId) {
    const project = this.projects.read(projectId);
    if (project.status !== 'approved-image' && project.status !== 'metadata-ready' && project.status !== 'metadata-recovery-needed') {
      throw new Error('Image must pass review before generating metadata.');
    }
    if (!project.sourceUrl) throw new Error('Paste the Amazon link before generating POD WINNER metadata.');
    if (!project.generatedImagePath || !fs.existsSync(project.generatedImagePath)) throw new Error('Approved design image is missing.');

    try {
      const { page } = await this.sessions.ensureService('chatgpt');
      await page.bringToFront();
      if (!page.url().startsWith('https://chatgpt.com')) {
        await retryStep('Open ChatGPT for metadata', () => page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 25000 }), { attempts: 2 });
      }

      // Recovery path for exactly the live failure the user reported: if ChatGPT
      // already visibly returned valid inline JSON but the previous ZeroPOD build
      // failed to consume it, Retry Metadata should harvest that response instead
      // of needlessly asking ChatGPT to generate it again.
      if (project.status === 'metadata-recovery-needed') {
        const existing = await this.parseLatestVisibleAssistant(page, 2);
        if (existing?.metadata) return this.saveMetadata(projectId, project, existing.metadata);
      }

      this.projects.update(projectId, { status: 'metadata-generating', metadataError: null });
      const baseline = await this.snapshotAssistant(page);
      await this.attachApprovedDesign(page, project);
      await this.submitPrompt(page, this.buildPrompt(project));

      let result;
      try {
        result = await this.waitForAssistantMetadata(page, baseline);
      } catch (firstError) {
        const correctionBaseline = await this.snapshotAssistant(page);
        await this.submitPrompt(page, [
          'Correct your previous response.',
          'Return ONLY valid JSON matching the requested POD WINNER schema.',
          'Use exactly 1 mainTag and exactly 14 unique supportingTags.',
          'Do not add markdown, prose, or code fences.'
        ].join('\n'));
        result = await this.waitForAssistantMetadata(page, correctionBaseline);
      }

      return this.saveMetadata(projectId, project, result.metadata);
    } catch (error) {
      const recovery = automationError(
        'chatgpt',
        'metadata',
        error,
        'Open ChatGPT from Connections, confirm the conversation is responsive, then retry Generate Metadata. ZeroPOD will first try to consume any valid inline JSON already visible before sending another request.'
      );
      this.projects.update(projectId, { status: 'metadata-recovery-needed', metadataError: recovery });
      throw new Error(recovery.message);
    }
  }
}

module.exports = { MetadataController };
