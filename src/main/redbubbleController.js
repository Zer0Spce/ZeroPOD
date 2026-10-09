const fs = require('fs');

class RedbubbleController {
  constructor({ sessions, projects }) {
    this.sessions = sessions;
    this.projects = projects;
  }

  async findAndClick(page, candidates, timeout = 12000) {
    for (const candidate of candidates) {
      try {
        await candidate.waitFor({ state: 'visible', timeout });
        await candidate.click();
        return true;
      } catch {}
    }
    return false;
  }

  async fillFirst(page, selectors, value) {
    for (const selector of selectors) {
      const field = page.locator(selector).first();
      try {
        await field.waitFor({ state: 'visible', timeout: 6000 });
        await field.fill(value);
        return true;
      } catch {}
    }
    return false;
  }

  async prepare(projectId) {
    const project = this.projects.read(projectId);
    if (!project.finalPngPath || !fs.existsSync(project.finalPngPath)) {
      throw new Error('Final 4500×5400 PNG is missing. Export the project first.');
    }
    if (!project.metadata) throw new Error('POD WINNER metadata is missing.');

    const { page } = await this.sessions.ensureService('redbubble');
    await page.bringToFront();
    if (!page.url().includes('redbubble.com')) {
      await page.goto('https://www.redbubble.com/', { waitUntil: 'domcontentloaded' });
    }

    this.projects.update(projectId, { status: 'redbubble-preparing' });

    // Open the user-facing Copy Existing Work flow.
    const openedCopyFlow = await this.findAndClick(page, [
      page.getByRole('link', { name: /copy existing work/i }).first(),
      page.getByRole('button', { name: /copy existing work/i }).first(),
      page.getByText(/copy existing work/i, { exact: false }).first()
    ], 10000);

    if (!openedCopyFlow) {
      const addNewOpened = await this.findAndClick(page, [
        page.getByRole('link', { name: /add new work/i }).first(),
        page.getByRole('button', { name: /add new work/i }).first(),
        page.getByText(/add new work/i, { exact: false }).first()
      ], 10000);
      if (addNewOpened) {
        await page.waitForTimeout(800);
        await this.findAndClick(page, [
          page.getByRole('link', { name: /copy existing work/i }).first(),
          page.getByRole('button', { name: /copy existing work/i }).first(),
          page.getByText(/copy existing work/i, { exact: false }).first()
        ], 10000);
      }
    }

    // Select the first existing work as the known-good baseline.
    const firstWorkCandidates = [
      page.locator('a[href*="copy"]').first(),
      page.locator('button').filter({ hasText: /copy/i }).first(),
      page.locator('[data-testid*="work"]').first(),
      page.locator('article').first(),
      page.locator('[role="listitem"]').first()
    ];
    let selectedBaseline = false;
    for (const candidate of firstWorkCandidates) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: 8000 });
        await candidate.click();
        selectedBaseline = true;
        break;
      } catch {}
    }
    if (!selectedBaseline) {
      throw new Error('Could not select the first Redbubble work. Open Copy Existing Work manually, then retry.');
    }

    await page.waitForTimeout(1200);

    // Replace the main artwork while preserving product configuration inherited from the copy.
    let fileInput = page.locator('input[type="file"]').first();
    if (!(await fileInput.count())) {
      await this.findAndClick(page, [
        page.getByRole('button', { name: /replace|upload|change image|change artwork/i }).first(),
        page.getByText(/replace image|change image|upload new/i, { exact: false }).first()
      ], 6000);
      fileInput = page.locator('input[type="file"]').first();
    }
    if (!(await fileInput.count())) throw new Error('Could not find the Redbubble main artwork upload control.');
    await fileInput.setInputFiles(project.finalPngPath);

    const meta = project.metadata;
    const allTags = [meta.mainTag, ...(meta.supportingTags || [])].filter(Boolean).join(', ');

    const titleFilled = await this.fillFirst(page, [
      'input[name="title"]',
      'input[id*="title"]',
      'input[placeholder*="title" i]'
    ], meta.title);
    const tagsFilled = await this.fillFirst(page, [
      'textarea[name="tags"]',
      'input[name="tags"]',
      'textarea[id*="tag"]',
      'input[id*="tag"]'
    ], allTags);
    const descriptionFilled = await this.fillFirst(page, [
      'textarea[name="description"]',
      'textarea[id*="description"]',
      'textarea[placeholder*="description" i]'
    ], meta.description);

    if (!titleFilled || !tagsFilled || !descriptionFilled) {
      throw new Error('Redbubble listing fields changed or were not found. ZeroPOD left the copied work open for manual review.');
    }

    const updated = this.projects.update(projectId, {
      status: 'redbubble-review',
      redbubble: {
        preparedAt: new Date().toISOString(),
        baseline: 'first-existing-work',
        title: meta.title,
        tags: allTags,
        description: meta.description,
        finalPngPath: project.finalPngPath,
        publishedAt: project.redbubble?.publishedAt || null
      }
    });

    return {
      ok: true,
      project: updated,
      message: 'Redbubble copy is prepared. Review the inherited product settings and listing in Redbubble, then use Publish from ZeroPOD when ready.'
    };
  }

  async publish(projectId) {
    const project = this.projects.read(projectId);
    if (project.status !== 'redbubble-review') {
      throw new Error('Prepare the Redbubble copy and review it before publishing.');
    }

    const { page } = await this.sessions.ensureService('redbubble');
    await page.bringToFront();

    const clicked = await this.findAndClick(page, [
      page.getByRole('button', { name: /save work|publish|submit/i }).last(),
      page.getByRole('button', { name: /save changes/i }).last(),
      page.locator('button[type="submit"]').last()
    ], 10000);

    if (!clicked) throw new Error('Could not find the final Redbubble publish/save button.');

    const updated = this.projects.update(projectId, {
      status: 'published',
      redbubble: {
        ...(project.redbubble || {}),
        publishedAt: new Date().toISOString()
      }
    });

    return { ok: true, project: updated };
  }
}

module.exports = { RedbubbleController };
