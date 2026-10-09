const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ProjectStore {
  getRoot() {
    return path.join(app.getPath('userData'), 'projects');
  }

  getProjectDir(projectId) {
    return path.join(this.getRoot(), projectId);
  }

  getProjectFile(projectId) {
    return path.join(this.getProjectDir(projectId), 'project.json');
  }

  create({ referencePath, sourceUrl = '' }) {
    const projectId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = this.getProjectDir(projectId);
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(referencePath) || '.png';
    const referenceCopy = path.join(dir, `reference${ext.toLowerCase()}`);
    fs.copyFileSync(referencePath, referenceCopy);

    const project = {
      id: projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'created',
      sourceUrl,
      referencePath: referenceCopy,
      generatedImagePath: null,
      review: { decision: null, notes: '' },
      metadata: null,
      vectorPath: null,
      finalPngPath: null
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
    project.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.getProjectFile(project.id), JSON.stringify(project, null, 2), 'utf8');
    return project;
  }

  update(projectId, patch) {
    const project = this.read(projectId);
    const next = { ...project, ...patch };
    return this.write(next);
  }

  list() {
    const root = this.getRoot();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try { return this.read(entry.name); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
}

module.exports = { ProjectStore };
