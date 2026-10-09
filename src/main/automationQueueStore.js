const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AutomationQueueStore {
  getFile() {
    return path.join(app.getPath('userData'), 'automation-list.json');
  }

  read() {
    const file = this.getFile();
    if (!fs.existsSync(file)) return { state: 'stopped', rows: [], updatedAt: null };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        state: parsed.state || 'stopped',
        rows: Array.isArray(parsed.rows) ? parsed.rows : [],
        updatedAt: parsed.updatedAt || null
      };
    } catch {
      return { state: 'stopped', rows: [], updatedAt: null };
    }
  }

  write(data) {
    const next = { ...data, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.getFile()), { recursive: true });
    fs.writeFileSync(this.getFile(), JSON.stringify(next, null, 2), 'utf8');
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
        projectId: row.projectId || null,
        lastError: row.lastError || null,
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

  setState(state) {
    const data = this.read();
    data.state = state;
    return this.write(data);
  }
}

module.exports = { AutomationQueueStore };
