const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ProjectStore {
  getRoot() { return path.join(app.getPath('userData'), 'projects'); }
  getProjectDir(projectId) { return path.join(this.getRoot(), projectId); }
  getProjectFile(projectId) { return path.join(this.getProjectDir(projectId), 'project.json'); }

  create({ referencePath, sourceUrl = '' }) {
    const projectId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = this.getProjectDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(referencePath) || '.png';
    const referenceCopy = path.join(dir, `reference-original${ext.toLowerCase()}`);
    fs.copyFileSync(referencePath, referenceCopy);
    const now = new Date().toISOString();
    const project = {
      id: projectId, createdAt: now, updatedAt: now, status: 'created', sourceUrl,
      referencePath: referenceCopy, generatedImagePath: null, approvedImagePath: null,
      review: { decision: null, notes: '' }, metadata: null, vectorPath: null, finalPngPath: null,
      archivedAt: null,
      activity: [{ at: now, type: 'status', from: null, to: 'created', label: 'Project created' }]
    };
    this.write(project);
    return project;
  }

  read(projectId) {
    const file = this.getProjectFile(projectId);
    if (!fs.existsSync(file)) throw new Error(`Project not found: ${projectId}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  write(project) {
    const dir = this.getProjectDir(project.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = this.getProjectFile(project.id);
    let previous = null;
    try { if (fs.existsSync(file)) previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const now = new Date().toISOString();
    const activity = Array.isArray(project.activity) ? [...project.activity] : Array.isArray(previous?.activity) ? [...previous.activity] : [];
    if (previous && previous.status !== project.status) {
      activity.push({ at: now, type: 'status', from: previous.status || null, to: project.status, label: `${previous.status || 'unknown'} → ${project.status}` });
    }
    project.activity = activity.slice(-250);
    project.updatedAt = now;
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf8');
    return project;
  }

  update(projectId, patch) { return this.write({ ...this.read(projectId), ...patch }); }

  addActivity(projectId, entry) {
    const project = this.read(projectId);
    const activity = Array.isArray(project.activity) ? [...project.activity] : [];
    activity.push({ at: entry.at || new Date().toISOString(), type: entry.type || 'event', label: entry.label || entry.message || 'Project event', details: entry.details || null });
    project.activity = activity.slice(-250);
    return this.write(project);
  }

  list(options = {}) {
    const includeArchived = Boolean(options.includeArchived);
    const archivedOnly = Boolean(options.archivedOnly);
    const root = this.getRoot();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => { try { return this.read(entry.name); } catch { return null; } })
      .filter(Boolean)
      .filter((project) => archivedOnly ? Boolean(project.archivedAt) : includeArchived ? true : !project.archivedAt)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  archive(projectId) {
    const project = this.read(projectId);
    if (project.archivedAt) return project;
    const archivedAt = new Date().toISOString();
    project.archivedAt = archivedAt;
    this.write(project);
    return this.addActivity(projectId, { type: 'workspace', label: 'Project archived', at: archivedAt });
  }

  restore(projectId) {
    const project = this.read(projectId);
    project.archivedAt = null;
    this.write(project);
    return this.addActivity(projectId, { type: 'workspace', label: 'Project restored from archive' });
  }

  delete(projectId) {
    const dir = this.getProjectDir(projectId);
    if (!fs.existsSync(dir)) throw new Error(`Project not found: ${projectId}`);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, projectId };
  }

  findBySourceUrl(sourceUrl, excludeProjectId = null) {
    const normalized = String(sourceUrl || '').trim().replace(/\/$/, '').toLowerCase();
    if (!normalized) return [];
    return this.list({ includeArchived: true }).filter((project) => {
      if (excludeProjectId && project.id === excludeProjectId) return false;
      return String(project.sourceUrl || '').trim().replace(/\/$/, '').toLowerCase() === normalized;
    });
  }
}

module.exports = { ProjectStore };
