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
        step: referenceImage && amazonLink ? 'Waiting' : 'Complete image + Amazon link',
        checkpoint: referenceImage && amazonLink ? 'input-ready' : 'draft'
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
      patch.checkpoint = complete ? 'input-ready' : 'draft';
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
        checkpoint: complete ? 'input-ready' : 'draft',
        lastError: null
      });
    }
    return this.store.updateRow(rowId, { status: 'ready', step: 'Retry queued', lastError: null });
  }

  removeRow(rowId) { return this.store.removeRow(rowId); }
  clearCompleted() { return this.store.clearCompleted(); }

  async recoverAfterRestart() {
    const data = this.store.read();
    const recoveredAt = new Date().toISOString();
    let changed = false;
    let recoveredRows = 0;

    if (data.state === 'running') {
      data.state = 'paused';
      changed = true;
    }

    for (const row of data.rows) {
      if (!row.projectId) {
        if (row.status === 'running') {
          const complete = row.referenceImage && row.amazonLink;
          row.status = complete ? 'pending' : 'draft';
          row.step = complete ? 'Recovered · Waiting' : 'Complete image + Amazon link';
          row.checkpoint = complete ? 'input-ready' : 'draft';
          row.recoveredAt = recoveredAt;
          changed = true;
          recoveredRows += 1;
        }
        continue;
      }

      let project;
      try { project = this.projects.read(row.projectId); } catch {
        row.status = 'needs-attention';
        row.step = 'Linked project missing';
        row.lastError = `Project ${row.projectId} could not be found after restart.`;
        row.recoveredAt = recoveredAt;
        changed = true;
        recoveredRows += 1;
        continue;
      }

      const recoveredProject = this.recoverTransientProject(project, recoveredAt);
      if (recoveredProject.changed) {
        project = recoveredProject.project;
        changed = true;
        recoveredRows += 1;
      }

      const mapped = this.mapProjectToRow(project);
      if (mapped) {
        Object.assign(row, mapped, { recoveredAt: recoveredProject.changed ? recoveredAt : row.recoveredAt || null });
        changed = true;
      }
    }

    if (changed) {
      data.recovery = {
        type: 'restart-reconciliation', at: recoveredAt, recoveredRows,
        message: recoveredRows
          ? `ZeroPOD recovered ${recoveredRows} queue item${recoveredRows === 1 ? '' : 's'} after restart. The queue is paused so you can review sessions before resuming.`
          : 'ZeroPOD restored the Automation List after restart. The queue is paused until you resume it.'
      };
      this.store.write(data);
    }
    return this.snapshot();
  }

  recoverTransientProject(project, recoveredAt) {
    const patch = {};
    let changed = false;
    if (['generating', 'regenerating'].includes(project.status)) {
      if (project.generatedImagePath && fs.existsSync(project.generatedImagePath)) patch.status = 'awaiting-review';
      else {
        patch.status = 'chatgpt-recovery-needed';
        patch.chatgptError = { step: 'restart-recovery', message: 'Generation was interrupted when ZeroPOD closed.', recovery: 'Open ChatGPT if needed, then Retry this queue row. ZeroPOD will reuse the same project and reference image.', at: recoveredAt };
      }
      changed = true;
    } else if (project.status === 'metadata-generating') {
      if (project.metadata) patch.status = 'metadata-ready';
      else {
        patch.status = 'metadata-recovery-needed';
        patch.metadataError = { service: 'ChatGPT', step: 'restart-recovery', message: 'Metadata generation was interrupted when ZeroPOD closed.', recovery: 'Retry Metadata. ZeroPOD will reuse the approved project and Amazon/source URL.', at: recoveredAt };
      }
      changed = true;
    } else if (['vectorizing', 'vectorizer-manual-download'].includes(project.status)) {
      if (project.vectorPath && fs.existsSync(project.vectorPath)) patch.status = 'vector-ready';
      else {
        patch.status = 'vectorizer-recovery-needed';
        patch.lastAutomationError = { service: 'Vectorizer.ai', step: 'restart-recovery', message: 'Vectorization/download capture was interrupted when ZeroPOD closed.', recovery: 'Retry Vectorizer. If Vectorizer.ai already finished, use its normal SVG download control after reconnecting.', at: recoveredAt };
      }
      changed = true;
    } else if (project.status === 'redbubble-preparing') {
      if (project.redbubble?.preparedAt) patch.status = 'redbubble-review';
      else {
        patch.status = 'redbubble-recovery-needed';
        patch.lastAutomationError = { service: 'Redbubble', step: 'restart-recovery', message: 'Redbubble preparation was interrupted when ZeroPOD closed.', recovery: 'Open Redbubble, verify the copied work state, then Retry Redbubble preparation. Final publish remains manual.', at: recoveredAt };
      }
      changed = true;
    }
    if (!changed) return { changed: false, project };
    return { changed: true, project: this.projects.update(project.id, patch) };
  }

  start() {
    this.stopRequested = false;
    this.store.setState('running', { recovery: null });
    if (!this.loopPromise) this.loopPromise = this.runLoop().finally(() => { this.loopPromise = null; });
    return this.snapshot();
  }

  pause() { this.store.setState('paused'); return this.snapshot(); }
  stop() { this.stopRequested = true; this.store.setState('stopped'); return this.snapshot(); }

  async runLoop() {
    while (!this.stopRequested) {
      const data = this.store.read();
      if (data.state === 'stopped') break;
      if (data.state === 'paused') { await wait(1500); continue; }

      await this.syncRows();
      const row = this.findRunnableRow();
      if (!row) { await wait(2500); continue; }

      try { await this.processRow(row); }
      catch (error) {
        this.store.updateRow(row.id, { status: 'needs-attention', step: 'Error', lastError: error.message || String(error) });
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
      generating: ['running', project.automationStep || 'Generating image', 'chatgpt-generation'],
      regenerating: ['running', project.automationStep || 'Regenerating image', 'chatgpt-generation'],
      'awaiting-review': ['awaiting-review', 'Waiting for image review', 'image-review'],
      'chatgpt-recovery-needed': ['needs-attention', 'ChatGPT needs attention', 'chatgpt-recovery'],
      'approved-image': ['ready', 'Ready for POD WINNER metadata', 'image-approved'],
      'metadata-generating': ['running', 'Generating POD WINNER metadata', 'metadata-generation'],
      'metadata-recovery-needed': ['needs-attention', 'Metadata needs attention', 'metadata-recovery'],
      'metadata-ready': ['ready', 'Ready for Vectorizer.ai', 'metadata-ready'],
      vectorizing: ['running', 'Vectorizing', 'vectorizing'],
      'vectorizer-manual-download': ['running', 'Waiting for Vectorizer SVG download', 'vectorizer-download'],
      'vectorizer-recovery-needed': ['needs-attention', 'Vectorizer.ai needs attention', 'vectorizer-recovery'],
      'vector-ready': ['ready', 'Ready for 4500×5400 export', 'vector-ready'],
      'export-ready': ['ready', 'Ready for Redbubble preparation', 'export-ready'],
      'redbubble-preparing': ['running', 'Preparing Redbubble copy', 'redbubble-prepare'],
      'redbubble-recovery-needed': ['needs-attention', 'Redbubble needs attention', 'redbubble-recovery'],
      'redbubble-review': ['awaiting-publish-review', 'Waiting for final Redbubble review', 'publish-review'],
      'redbubble-publish-pending': ['awaiting-publish-review', 'Publish pending verification', 'publish-verification'],
      published: ['completed', 'Published', 'completed']
    };
    const mapped = map[project.status];
    if (!mapped) return null;
    return { status: mapped[0], step: mapped[1], checkpoint: mapped[2], lastError: this.projectError(project) };
  }

  projectError(project) { return project.chatgptError?.message || project.metadataError?.message || project.lastAutomationError?.message || null; }

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

  markRunning(rowId, step, checkpoint) {
    return this.store.updateRow(rowId, { status: 'running', step, checkpoint, lastError: null });
  }

  async processRow(row) {
    if (!row.projectId) {
      if (!row.referenceImage || !row.amazonLink) throw new Error('Reference image and Amazon/source link are required.');
      if (!fs.existsSync(row.referenceImage)) throw new Error(`Reference image not found: ${row.referenceImage}`);
      this.markRunning(row.id, 'Opening ChatGPT', 'chatgpt-open');
      const result = await this.chatgpt.start({
        referencePath: row.referenceImage,
        sourceUrl: row.amazonLink,
        reviewNotes: row.notes || '',
        onStep: (message) => this.store.updateRow(row.id, { status: 'running', step: message, checkpoint: 'chatgpt-generation' })
      });
      this.store.updateRow(row.id, { projectId: result.projectId, status: 'running', step: 'Waiting for generated image', checkpoint: 'chatgpt-generation' });
      return;
    }

    const project = this.projects.read(row.projectId);

    if (project.status === 'chatgpt-recovery-needed') {
      this.markRunning(row.id, 'Retrying ChatGPT generation', 'chatgpt-retry');
      await this.chatgpt.start({
        referencePath: project.referencePath,
        sourceUrl: project.sourceUrl,
        reviewNotes: row.notes || '',
        existingProjectId: project.id,
        onStep: (message) => this.store.updateRow(row.id, { status: 'running', step: message, checkpoint: 'chatgpt-generation' })
      });
      return;
    }

    if (['approved-image', 'metadata-recovery-needed'].includes(project.status)) {
      this.markRunning(row.id, 'Generating POD WINNER metadata', 'metadata-generation');
      await this.metadata.generate(project.id);
      return;
    }
    if (['metadata-ready', 'vectorizer-recovery-needed'].includes(project.status)) {
      this.markRunning(row.id, 'Vectorizing approved design', 'vectorizing');
      await this.vectorizer.start(project.id);
      return;
    }
    if (project.status === 'vector-ready') {
      this.markRunning(row.id, 'Exporting 4500×5400 PNG', 'exporting');
      await this.exporter.exportPng(project.id);
      return;
    }
    if (['export-ready', 'redbubble-recovery-needed'].includes(project.status)) {
      this.markRunning(row.id, 'Running quality check', 'quality-check');
      const validation = await validateProject(project, this.projects.list());
      this.projects.update(project.id, { qualityCheck: { ...validation, checkedAt: new Date().toISOString() } });
      if (!validation.ok) throw new Error(`Quality check failed: ${validation.errors.join(' ')}`);
      this.markRunning(row.id, 'Preparing Redbubble Copy Existing Work', 'redbubble-prepare');
      await this.redbubble.prepare(project.id);
    }
  }
}

module.exports = { AutomationQueueController };
