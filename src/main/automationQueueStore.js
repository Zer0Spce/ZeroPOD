const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AutomationQueueStore {
  getFile() {
    return path.join(app.getPath('userData'), 'automation-list.json');
  }

  getBackupFile() {
    return `${this.getFile()}.bak`;
  }

  emptyState() {
    return {
      state: 'stopped',
      rows: [],
      updatedAt: null,
      recovery: null,
      lastCleanShutdownAt: null
    };
  }

  normalize(parsed = {}) {
    return {
      state: parsed.state || 'stopped',
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      updatedAt: parsed.updatedAt || null,
      recovery: parsed.recovery || null,
      lastCleanShutdownAt: parsed.lastCleanShutdownAt || null
    };
  }

  readJson(file) {
    return this.normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  read() {
    const file = this.getFile();
    const backup = this.getBackupFile();
    if (!fs.existsSync(file)) return this.emptyState();
    try {
      return this.readJson(file);
    } catch {
      try {
        if (fs.existsSync(backup)) {
          const recovered = this.readJson(backup);
          recovered.recovery = {
            type: 'queue-file-restored',
            message: 'The primary Automation List file was unreadable, so ZeroPOD restored the most recent backup.',
            at: new Date().toISOString()
          };
          return recovered;
        }
      } catch {}
      return this.emptyState();
    }
  }

  write(data) {
    const next = { ...data, updatedAt: new Date().toISOString() };
    const file = this.getFile();
    const backup = this.getBackupFile();
    const temp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    } catch {}

    fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
    fs.copyFileSync(temp, file);
    fs.rmSync(temp, { force: true });
    return next;
  }

  addRows(rows) {
    const data = this.read();
    const now = new Date().toISOString();
    for (const row of rows) {
      data.rows.push({
        id: row.id || `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        enabled: row.enabled !== false,
        referenceImage: String(row.referenceImage || '').trim(),
        amazonLink: String(row.amazonLink || '').trim(),
        notes: String(row.notes || '').trim(),
        status: row.status || 'pending',
        step: row.step || 'Waiting',
        checkpoint: row.checkpoint || null,
        projectId: row.projectId || null,
        lastError: row.lastError || null,
        recoveredAt: row.recoveredAt || null,
        createdAt: row.createdAt || now,
        updatedAt: now
      });
    }
    return this.write(data);
  }

  updateRow(rowId, patch) {
    const data = this.read();
    const index = data.rows.findIndex((row) => row.id === rowId);
    if (index === -1) throw new Error(`Automation row not found: ${rowId}`);
    data.rows[index] = { ...data.rows[index], ...patch, updatedAt: new Date().toISOString() };
    this.write(data);
    return data.rows[index];
  }

  updateManyRows(patches) {
    const data = this.read();
    const byId = new Map(patches.map((item) => [item.rowId, item.patch]));
    data.rows = data.rows.map((row) => {
      const patch = byId.get(row.id);
      return patch ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row;
    });
    return this.write(data);
  }

  moveRows(rowIds, direction) {
    const data = this.read();
    const selected = new Set(rowIds || []);
    if (!selected.size) return data;
    if (!['up', 'down', 'top', 'bottom'].includes(direction)) throw new Error(`Unsupported queue move: ${direction}`);
    if (data.rows.some((row) => selected.has(row.id) && row.status === 'running')) {
      throw new Error('Running rows cannot be reordered. Pause or let the current stage finish first.');
    }

    if (direction === 'top' || direction === 'bottom') {
      const chosen = data.rows.filter((row) => selected.has(row.id));
      const other = data.rows.filter((row) => !selected.has(row.id));
      data.rows = direction === 'top' ? [...chosen, ...other] : [...other, ...chosen];
      return this.write(data);
    }

    if (direction === 'up') {
      for (let i = 1; i < data.rows.length; i += 1) {
        if (selected.has(data.rows[i].id) && !selected.has(data.rows[i - 1].id)) {
          [data.rows[i - 1], data.rows[i]] = [data.rows[i], data.rows[i - 1]];
        }
      }
    } else {
      for (let i = data.rows.length - 2; i >= 0; i -= 1) {
        if (selected.has(data.rows[i].id) && !selected.has(data.rows[i + 1].id)) {
          [data.rows[i + 1], data.rows[i]] = [data.rows[i], data.rows[i + 1]];
        }
      }
    }
    return this.write(data);
  }

  removeRow(rowId) {
    const data = this.read();
    data.rows = data.rows.filter((row) => row.id !== rowId);
    return this.write(data);
  }

  clearCompleted() {
    const data = this.read();
    data.rows = data.rows.filter((row) => row.status !== 'completed');
    return this.write(data);
  }

  setState(state, extra = {}) {
    const data = this.read();
    data.state = state;
    Object.assign(data, extra);
    return this.write(data);
  }

  markCleanShutdown() {
    const data = this.read();
    data.lastCleanShutdownAt = new Date().toISOString();
    if (data.state === 'running') data.state = 'paused';
    return this.write(data);
  }
}

module.exports = { AutomationQueueStore };
