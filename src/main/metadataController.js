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

  async openRememberedThread(page) {
    const current = page.url();
    const isRealThread = (value) => /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{20,}$/i.test(String(value || ''));

    if (isRealThread(current)) {
      this.sessions.rememberThreadUrl('chatgpt', current);
      return;
    }

    const saved = this.sessions.getLastThreadUrl('chatgpt');
    if (isRealThread(saved)) {
      try {
        await page.goto(saved, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await this.locateComposer(page);
        return;
      } catch {
        this.sessions.clearLastThreadUrl?.('chatgpt');
      }
    }

    if (!page.url().startsWith('https://chatgpt.com')) {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await this.locateComposer(page);
  }

  async attachApprovedDesign(page, project) {
    const approvedPath = project.approvedImagePath || project.generatedImagePath;
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
    if (!parsed || typeof parsed !== 'object' || !parsed.title || !parsed.mainTag || !parsed.description || !Array.isArray(parsed.supportingTags)) {
      throw new Error('Metadata response is missing required fields.');
    }

    const metadata = {
      title: String(parsed.title).trim(),
      mainTag: this.normalizeTag(parsed.mainTag),
      description: String(parsed.description).trim(),
      optimizationMode: 'POD WINNER',
      supportingTags: parsed.supportingTags.map((tag) => this.normalizeTag(tag)).filter(Boolean)
    };

    const seen = new Set();
    const uniqueTags = [];
    const mainKey = this.canonicalTag(metadata.mainTag);
    for (const tag of metadata.supportingTags) {
      const key = this.canonicalTag(tag);
      if (!key || seen.has(key) || key === mainKey) continue;
      seen.add(key);
      uniqueTags.push(tag);
    }

    metadata.supportingTags = uniqueTags.slice(0, 14);
    if (!metadata.title || !metadata.mainTag || !metadata.description) throw new Error('Metadata response contains blank required fields.');
    if (metadata.supportingTags.length !== 14) throw new Error(`POD WINNER metadata must contain exactly 14 unique supporting tags; found ${metadata.supportingTags.length}.`);
    return metadata;
  }

  parseMetadata(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const objects = this.extractJSONObjects(text);
    if (!objects.length) throw new Error('ChatGPT did not return JSON metadata.');

    let lastError = null;
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(objects[i]);
        return this.normalizeMetadataObject(parsed);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('ChatGPT metadata JSON could not be parsed.');
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
      page.locator('button[aria-label*="send" i]:visible').first(),
      page.locator('button[type="submit"]:visible').first()
    ], { timeout: 5000 });
    if (!sent) await composer.press('Enter');

    const promptStart = prompt.slice(0, Math.min(60, prompt.length));
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const text = await this.composerText(composer);
      const stopVisible = await page.locator('button[data-testid="stop-button"], button[aria-label*="stop" i]').first().isVisible().catch(() => false);
      if (!text.includes(promptStart) || stopVisible) return true;
      await wait(150);
    }
    throw new Error('ChatGPT kept the metadata prompt in the composer instead of sending it.');
  }

  async snapshotAssistant(page) {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    const count = await assistants.count();
    const lastText = count ? (await assistants.nth(count - 1).innerText().catch(() => '')).trim() : '';
    return { count, lastText };
  }

  async parseLatestVisibleAssistant(page, maxMessages = 6) {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    const count = await assistants.count();
    for (let offset = 0; offset < Math.min(maxMessages, count); offset += 1) {
      const message = assistants.nth(count - 1 - offset);
      const texts = [
        (await message.innerText().catch(() => '')).trim(),
        (await message.locator('pre, code').allInnerTexts().catch(() => [])).join('\n').trim()
      ].filter(Boolean);
      for (const text of texts) {
        try {
          return { metadata: this.parseMetadata(text), raw: text };
        } catch {}
      }
    }

    // ChatGPT occasionally changes message wrappers. As a final recovery path,
    // scan the visible conversation text and accept only a fully valid metadata
    // object (the schema in the user's prompt cannot pass the 14-tag validation).
    const conversationText = await page.locator('main').innerText().catch(() => '');
    if (conversationText) {
      try {
        return { metadata: this.parseMetadata(conversationText), raw: conversationText };
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

          const visible = await this.parseLatestVisibleAssistant(page, 3);
          if (visible?.metadata) return visible;

          const stopVisible = await page.locator('button[data-testid="stop-button"], button[aria-label*="stop" i], button[data-testid*="stop" i]').first().isVisible().catch(() => false);
          if (!stopVisible && latestText && Date.now() - lastChangeAt > 2500) {
            const finalVisible = await this.parseLatestVisibleAssistant(page, 6);
            if (finalVisible?.metadata) return finalVisible;
          }
        }
      }
      await wait(250);
    }

    const finalVisible = await this.parseLatestVisibleAssistant(page, 8);
    if (finalVisible?.metadata) return finalVisible;

    const error = new Error(sawNewResponse
      ? 'ChatGPT returned metadata, but ZeroPOD could not find a valid Title + Main Tag + 14 Supporting Tags + Description object in the visible response.'
      : 'Timed out waiting for ChatGPT metadata response.');
    error.raw = latestText;
    throw error;
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

  async rememberCurrentThread(page) {
    const started = Date.now();
    while (Date.now() - started < 6000) {
      const current = page.url();
      if (/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{20,}$/i.test(current)) {
        this.sessions.rememberThreadUrl('chatgpt', current);
        return current;
      }
      await wait(150);
    }
    return null;
  }

  async generate(projectId) {
    const project = this.projects.read(projectId);
    if (project.status !== 'approved-image' && project.status !== 'metadata-ready' && project.status !== 'metadata-recovery-needed') {
      throw new Error('Image must pass review before generating metadata.');
    }
    if (!project.sourceUrl) throw new Error('Paste the Amazon link before generating POD WINNER metadata.');
    const approvedPath = project.approvedImagePath || project.generatedImagePath;
    if (!approvedPath || !fs.existsSync(approvedPath)) throw new Error('Approved design image is missing.');

    try {
      const { page } = await this.sessions.ensureService('chatgpt');
      await page.bringToFront();
      await this.openRememberedThread(page);

      // If an older build already got the response onto the screen, consume it
      // first. This is the failure shown in the beta screenshots: the JSON existed
      // in ChatGPT but ZeroPOD treated the step as failed.
      if (project.status === 'metadata-recovery-needed') {
        const existing = await this.parseLatestVisibleAssistant(page, 8);
        if (existing?.metadata) return this.saveMetadata(projectId, project, existing.metadata);
      }

      this.projects.update(projectId, { status: 'metadata-generating', metadataError: null });
      const baseline = await this.snapshotAssistant(page);
      await this.attachApprovedDesign(page, project);
      await this.submitPrompt(page, this.buildPrompt(project));
      await this.rememberCurrentThread(page);

      const result = await this.waitForAssistantMetadata(page, baseline);
      return this.saveMetadata(projectId, project, result.metadata);
    } catch (error) {
      const recovery = automationError(
        'chatgpt',
        'metadata',
        error,
        'Keep the current ChatGPT thread open and retry Generate Metadata. ZeroPOD will first consume any valid inline JSON already visible before sending another request.'
      );
      this.projects.update(projectId, { status: 'metadata-recovery-needed', metadataError: recovery });
      throw new Error(recovery.message);
    }
  }
}

module.exports = { MetadataController };
