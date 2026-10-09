const { retryStep, clickFirstVisible, automationError } = require('./automationUtils');

class MetadataController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  buildPrompt(project) {
    if (!project.sourceUrl) throw new Error('POD WINNER metadata requires the pasted Amazon/source link.');

    return [
      'POD WINNER MODE',
      'Create SEO-ready Redbubble listing metadata for the approved POD design in this project.',
      '',
      'PRIMARY RESEARCH SOURCE:',
      `Amazon reference URL: ${project.sourceUrl}`,
      '',
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
      '- Title, tags, and description all match the approved design and the Amazon-derived niche.',
      '- optimizationMode must equal exactly "POD WINNER".',
      '',
      'Use the approved design context from this conversation/project and produce the final metadata now.'
    ].join('\n');
  }

  async locateComposer(page) {
    const selectors = ['#prompt-textarea', 'textarea[placeholder*="Message"]', 'textarea', '[contenteditable="true"][data-placeholder]', '[contenteditable="true"]'];
    return retryStep('Locate ChatGPT metadata composer', async () => {
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
          await locator.waitFor({ state: 'visible', timeout: 3000 });
          return locator;
        } catch {}
      }
      throw new Error('Could not find the ChatGPT composer.');
    }, { attempts: 3, delayMs: 900 });
  }

  normalizeTag(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  canonicalTag(value) {
    return this.normalizeTag(value).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(s|es)\b/g, '').trim();
  }

  parseMetadata(raw) {
    const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('ChatGPT did not return JSON metadata.');

    const parsed = JSON.parse(trimmed.slice(start, end + 1));
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

  async submitPrompt(page, prompt) {
    const composer = await this.locateComposer(page);
    await composer.click();
    await composer.fill(prompt).catch(async () => composer.pressSequentially(prompt, { delay: 1 }));
    const sent = await clickFirstVisible([
      page.locator('button[data-testid="send-button"]').first(),
      page.getByRole('button', { name: /send/i }).first(),
      page.locator('button[aria-label*="send" i]').first()
    ], { timeout: 4000 });
    if (!sent) await composer.press('Enter');
  }

  async waitForAssistantResponse(page, previousCount) {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-message-author-role="assistant"]').length > count,
      previousCount,
      { timeout: 180000 }
    );
    const response = assistants.last();
    await response.waitFor({ state: 'visible', timeout: 30000 });

    let lastText = '';
    let stableChecks = 0;
    for (let i = 0; i < 60; i += 1) {
      const text = (await response.innerText()).trim();
      if (text && text === lastText) stableChecks += 1;
      else stableChecks = 0;
      lastText = text;
      if (stableChecks >= 2) break;
      await page.waitForTimeout(900);
    }
    return lastText;
  }

  async generate(projectId) {
    const project = this.projects.read(projectId);
    if (project.status !== 'approved-image' && project.status !== 'metadata-ready' && project.status !== 'metadata-recovery-needed') {
      throw new Error('Image must pass review before generating metadata.');
    }
    if (!project.sourceUrl) throw new Error('Paste the Amazon link before generating POD WINNER metadata.');

    try {
      const { page } = await this.sessions.ensureService('chatgpt');
      await page.bringToFront();
      if (!page.url().startsWith('https://chatgpt.com')) {
        await retryStep('Open ChatGPT for metadata', () => page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }), { attempts: 2 });
      }

      this.projects.update(projectId, { status: 'metadata-generating', metadataError: null });
      const assistants = page.locator('[data-message-author-role="assistant"]');
      const previousCount = await assistants.count();
      await this.submitPrompt(page, this.buildPrompt(project));
      let raw = await this.waitForAssistantResponse(page, previousCount);
      let metadata;

      try {
        metadata = this.parseMetadata(raw);
      } catch (firstError) {
        const correctionCount = await assistants.count();
        await this.submitPrompt(page, [
          'Correct your previous response.',
          'Return ONLY valid JSON matching the requested POD WINNER schema.',
          'Use exactly 1 mainTag and exactly 14 unique supportingTags.',
          'Do not add markdown, prose, or code fences.'
        ].join('\n'));
        raw = await this.waitForAssistantResponse(page, correctionCount);
        metadata = this.parseMetadata(raw);
      }

      const updated = this.projects.update(projectId, {
        status: 'metadata-ready',
        metadata,
        metadataMode: 'POD WINNER',
        metadataSourceUrl: project.sourceUrl,
        metadataError: null
      });
      return { ok: true, metadata, project: updated };
    } catch (error) {
      const recovery = automationError(
        'chatgpt',
        'metadata',
        error,
        'Open ChatGPT from Connections, confirm the conversation is responsive, then retry Generate Metadata. ZeroPOD will reuse the approved project and Amazon source URL.'
      );
      this.projects.update(projectId, { status: 'metadata-recovery-needed', metadataError: recovery });
      throw new Error(recovery.message);
    }
  }
}

module.exports = { MetadataController };
