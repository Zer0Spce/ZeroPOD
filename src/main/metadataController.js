class MetadataController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  buildPrompt(project) {
    return [
      'Create Redbubble listing metadata for the approved POD design in this project.',
      'Return ONLY valid JSON. No markdown, no code fences.',
      'Schema:',
      '{',
      '  "title": "...",',
      '  "mainTag": "...",',
      '  "supportingTags": ["..."],',
      '  "description": "..."',
      '}',
      '',
      'Requirements:',
      '- Exactly 1 main tag.',
      '- Exactly 14 supporting tags.',
      '- Keep tags relevant, natural, and search-friendly.',
      '- Avoid keyword stuffing.',
      '- Do not use brand or trademark names unless clearly generic and appropriate.',
      '- Keep the short description concise and natural.',
      project.sourceUrl ? `Reference/source URL for niche context only: ${project.sourceUrl}` : '',
      '',
      'Use the approved design context from this conversation/project and produce the listing metadata now.'
    ].filter(Boolean).join('\n');
  }

  async locateComposer(page) {
    const selectors = ['#prompt-textarea', 'textarea[placeholder*="Message"]', 'textarea', '[contenteditable="true"]'];
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) return locator;
    }
    throw new Error('Could not find the ChatGPT composer.');
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
    parsed.supportingTags = parsed.supportingTags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 14);
    if (parsed.supportingTags.length !== 14) throw new Error('Metadata must contain exactly 14 supporting tags.');
    return parsed;
  }

  async generate(projectId) {
    const project = this.projects.read(projectId);
    if (project.status !== 'approved-image' && project.status !== 'metadata-ready') {
      throw new Error('Image must pass review before generating metadata.');
    }

    const { page } = await this.sessions.ensureService('chatgpt');
    await page.bringToFront();
    const composer = await this.locateComposer(page);
    await composer.click();
    await composer.fill(this.buildPrompt(project)).catch(async () => {
      await composer.pressSequentially(this.buildPrompt(project), { delay: 1 });
    });

    const sendButton = page.locator('button[data-testid="send-button"]').first();
    if (await sendButton.count()) await sendButton.click();
    else await composer.press('Enter');

    const assistants = page.locator('[data-message-author-role="assistant"]');
    const previousCount = await assistants.count();
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-message-author-role="assistant"]').length > count,
      previousCount,
      { timeout: 180000 }
    ).catch(() => {});

    const response = assistants.last();
    await response.waitFor({ state: 'visible', timeout: 180000 });
    const raw = await response.innerText();
    const metadata = this.parseMetadata(raw);
    const updated = this.projects.update(projectId, { status: 'metadata-ready', metadata });
    return { ok: true, metadata, project: updated };
  }
}

module.exports = { MetadataController };
