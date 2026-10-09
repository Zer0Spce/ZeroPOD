const fs = require('fs');
const { validateProject } = require('./qualityControl');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class AutomationQueueController {
  constructor({ store, projects, chatgpt, metadata, vectorizer, exporter, redbubble }) {
    this.store = store;
    this.projects = projects;
    this.chatgpt = chatgpt;
    this.metadata = metadata;
    this.vectorizer = vectorizer;
    this.exporter = exporter;
    this.redbubble = redbubble;
    this.loopPromise = null;
    this.stopRequested = false;
  }

  snapshot() {
    const data = this.store.read();
    return {
      ...data,
      counts: data.rows.reduce((acc, row) => {
        acc.total += 1;
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, { total: 0 })
    };
  }

  addRows(rows) {
    const cleaned = rows.map((row) => {
      const referenceImage = String(row.referenceImage || '').trim();
      const amazonLink = String(row.amazonLink || '').trim();
      return {
        enabled: row.enabled !== false,
        referenceImage,
        amazonLink,
        notes: String(row.notes || '').trim(),
        status: referenceImage && amazonLink ? 'pending' : 'draft',
        step: referenceImage && amazonLink ? 'Waiting' : 'Complete image + Amazon link'
      };
    });
    return this.store.addRows(cleaned);
  }

  updateRow(rowId, patch) {
    const current = this.store.read().rows.find((row) => row.id === rowId);
    if (!current) throw new Error(`Automation row not found: ${rowId}`);
    const next = { ...current, ...patch };
    if (!next.projectId && ['draft', 'pending', 'needs-attention'].includes(next.status)) {
      const complete = String(next.referenceImage || '').trim() && String(next.amazonLink || '').trim();
      patch.status = complete ? 'pending' : 'draft';
      patch.step = complete ? 'Waiting' : 'Complete image + Amazon link';
      if (complete) patch.lastError = null;
    }
    return this.store.updateRow(rowId, patch);
  }

  retry(rowId) {
    const row = this.store.read().rows.find((item) => item.id === rowId);
    if (!row) throw new Error(`Automation row not found: ${rowId}`);
    if (!row.projectId) {
      const complete = row.referenceImage && row.amazonLink;
      return this.store.updateRow(rowId, {
        status: complete ? 'pending' : 'draft',
        step: complete ? 'Waiting' : 'Complete image + Amazon link',
        lastError: null
      });
    }
    return this.store.updateRow(rowId, { status: 'ready', step: 'Retry queued', lastError: null });
  }

  removeRow(rowId) {
    return this.store.removeRow(rowId);
  }

  clearCompleted() {
    return this.store.clearCompleted();
  }

  start() {
    this.stopRequested = false;
    this.store.setState('running');
    if (!this.loopPromise) {
      this.loopPromise = this.runLoop().finally(() => { this.loopPromise = null; });
    }
    return this.snapshot();
  }

  pause() {
    this.store.setState('paused');
    return this.snapshot();
  }

  stop() {
    this.stopRequested = true;
    this.store.setState('stopped');
    return this.snapshot();
  }

  async runLoop() {
    while (!this.stopRequested) {
      const data = this.store.read();
      if (data.state === 'stopped') break;
      if (data.state === 'paused') {
        await wait(1500);
        continue;
      }

      await this.syncRows();
      const row = this.findRunnableRow();
      if (!row) {
        await wait(2500);
        continue;
      }

      try {
        await this.processRow(row);
      } catch (error) {
        this.store.updateRow(row.id, {
          status: 'needs-attention',
          step: 'Error',
          lastError: error.message || String(error)
        });
      }

      await wait(1200);
    }
  }

  async syncRows() {
    const data = this.store.read();
    for (const row of data.rows) {
      if (!row.projectId) continue;
      let project;
      try { project = this.projects.read(row.projectId); } catch { continue; }
      const patch = this.mapProjectToRow(project);
      if (patch && row.status !== 'ready') this.store.updateRow(row.id, patch);
    }
  }

  mapProjectToRow(project) {
    const map = {
      generating: ['running', 'Generating image'],
      regenerating: ['running', 'Regenerating image'],
      'awaiting-review': ['awaiting-review', 'Waiting for image review'],
      'chatgpt-recovery-needed': ['needs-attention', 'ChatGPT needs attention'],
      'approved-image': ['ready', 'Ready for POD WINNER metadata'],
      'metadata-recovery-needed': ['needs-attention', 'Metadata needs attention'],
      'metadata-ready': ['ready', 'Ready for Vectorizer.ai'],
      vectorizing: ['running', 'Vectorizing'],
      'vectorizer-recovery-needed': ['needs-attention', 'Vectorizer.ai needs attention'],
      'vector-ready': ['ready', 'Ready for 4500×5400 export'],
      'export-ready': ['ready', 'Ready for Redbubble preparation'],
      'redbubble-preparing': ['running', 'Preparing Redbubble copy'],
      'redbubble-recovery-needed': ['needs-attention', 'Redbubble needs attention'],
      'redbubble-review': ['awaiting-publish-review', 'Waiting for final Redbubble review'],
      published: ['completed', 'Published']
    };
    const mapped = map[project.status];
    if (!mapped) return null;
    return { status: mapped[0], step: mapped[1], lastError: this.projectError(project) };
  }

  projectError(project) {
    return project.chatgptError?.message || project.metadataError?.message || project.lastAutomationError?.message || null;
  }

  findRunnableRow() {
    const data = this.store.read();
    const blocking = data.rows.some((row) => row.enabled && row.status === 'running');
    if (blocking) return null;

    return data.rows.find((row) => {
      if (!row.enabled) return false;
      if (['draft', 'completed', 'awaiting-review', 'awaiting-publish-review', 'needs-attention', 'skipped'].includes(row.status)) return false;
      return ['pending', 'ready'].includes(row.status);
    }) || null;
  }

  async processRow(row) {
    if (!row.projectId) {
      if (!row.referenceImage || !row.amazonLink) throw new Error('Reference image and Amazon/source link are required.');
      if (!fs.existsSync(row.referenceImage)) throw new Error(`Reference image not found: ${row.referenceImage}`);
      this.store.updateRow(row.id, { status: 'running', step: 'Submitting to ChatGPT', lastError: null });
      const result = await this.chatgpt.start({
        referencePath: row.referenceImage,
        sourceUrl: row.amazonLink,
        reviewNotes: row.notes || ''
      });
      this.store.updateRow(row.id, { projectId: result.projectId, status: 'running', step: 'Generating image' });
      return;
    }

    const project = this.projects.read(row.projectId);

    if (project.status === 'chatgpt-recovery-needed') {
      this.store.updateRow(row.id, { status: 'running', step: 'Retrying ChatGPT generation/download', lastError: null });
      await this.chatgpt.start({
        referencePath: project.referencePath,
        sourceUrl: project.sourceUrl,
        reviewNotes: row.notes || '',
        existingProjectId: project.id
      });
      return;
    }

    if (['approved-image', 'metadata-recovery-needed'].includes(project.status)) {
      this.store.updateRow(row.id, { status: 'running', step: 'Generating POD WINNER metadata', lastError: null });
      await this.metadata.generate(project.id);
      return;
    }

    if (['metadata-ready', 'vectorizer-recovery-needed'].includes(project.status)) {
      this.store.updateRow(row.id, { status: 'running', step: 'Vectorizing approved design', lastError: null });
      await this.vectorizer.start(project.id);
      return;
    }

    if (project.status === 'vector-ready') {
      this.store.updateRow(row.id, { status: 'running', step: 'Exporting 4500×5400 PNG', lastError: null });
      await this.exporter.exportPng(project.id);
      return;
    }

    if (['export-ready', 'redbubble-recovery-needed'].includes(project.status)) {
      this.store.updateRow(row.id, { status: 'running', step: 'Running quality check', lastError: null });
      const validation = await validateProject(project, this.projects.list());
      this.projects.update(project.id, { qualityCheck: { ...validation, checkedAt: new Date().toISOString() } });
      if (!validation.ok) throw new Error(`Quality check failed: ${validation.errors.join(' ')}`);
      this.store.updateRow(row.id, { status: 'running', step: 'Preparing Redbubble Copy Existing Work' });
      await this.redbubble.prepare(project.id);
      return;
    }
  }
}

module.exports = { AutomationQueueController };
