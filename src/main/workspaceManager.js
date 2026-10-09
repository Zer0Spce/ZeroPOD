const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class WorkspaceManager {
  constructor({ projects, automationStore }) {
    this.projects = projects;
    this.automationStore = automationStore;
  }

  exportTo(destinationRoot) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(destinationRoot, `ZeroPOD-Backup-${stamp}`);
    fs.mkdirSync(backupDir, { recursive: true });

    const projectsSource = this.projects.getRoot();
    const projectsDest = path.join(backupDir, 'projects');
    if (fs.existsSync(projectsSource)) fs.cpSync(projectsSource, projectsDest, { recursive: true });
    else fs.mkdirSync(projectsDest, { recursive: true });

    const queueFile = this.automationStore.getFile();
    if (fs.existsSync(queueFile)) fs.copyFileSync(queueFile, path.join(backupDir, 'automation-list.json'));

    const manifest = {
      format: 'ZeroPOD Workspace Backup',
      version: 2,
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      projectCount: this.projects.list({ includeArchived: true }).length,
      includes: ['projects', 'automation-list'],
      excludes: ['browser session profiles', 'passwords', 'cookies', 'credentials'],
      note: 'Browser login sessions are intentionally excluded from backups.'
    };
    fs.writeFileSync(path.join(backupDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: true, path: backupDir, manifest };
  }

  validateBackup(backupDir) {
    const manifestFile = path.join(backupDir, 'backup-manifest.json');
    if (!fs.existsSync(manifestFile)) throw new Error('Not a ZeroPOD workspace backup: backup-manifest.json is missing.');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
    catch { throw new Error('Backup manifest is unreadable or invalid JSON.'); }
    if (manifest.format !== 'ZeroPOD Workspace Backup') throw new Error('Selected folder is not a recognized ZeroPOD workspace backup.');
    const projectsDir = path.join(backupDir, 'projects');
    if (!fs.existsSync(projectsDir)) throw new Error('Backup is incomplete: projects folder is missing.');
    return { manifest, projectsDir, queueFile: path.join(backupDir, 'automation-list.json') };
  }

  remapProjectPaths(project, destinationDir) {
    const remap = (value) => {
      if (!value) return value;
      const candidate = path.join(destinationDir, path.basename(value));
      return fs.existsSync(candidate) ? candidate : value;
    };
    return {
      ...project,
      referencePath: remap(project.referencePath),
      generatedImagePath: remap(project.generatedImagePath),
      vectorPath: remap(project.vectorPath),
      finalPngPath: remap(project.finalPngPath),
      restoredAt: new Date().toISOString()
    };
  }

  restoreFrom(backupDir) {
    const { manifest, projectsDir, queueFile } = this.validateBackup(backupDir);
    const destinationRoot = this.projects.getRoot();
    fs.mkdirSync(destinationRoot, { recursive: true });
    let restoredProjects = 0;
    let skippedProjects = 0;

    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourceDir = path.join(projectsDir, entry.name);
      const sourceProjectFile = path.join(sourceDir, 'project.json');
      if (!fs.existsSync(sourceProjectFile)) continue;
      const destinationDir = path.join(destinationRoot, entry.name);
      if (fs.existsSync(destinationDir)) { skippedProjects += 1; continue; }
      fs.cpSync(sourceDir, destinationDir, { recursive: true });
      try {
        const projectFile = path.join(destinationDir, 'project.json');
        const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
        const remapped = this.remapProjectPaths(project, destinationDir);
        fs.writeFileSync(projectFile, JSON.stringify(remapped, null, 2), 'utf8');
      } catch {}
      restoredProjects += 1;
    }

    let restoredRows = 0;
    let skippedRows = 0;
    if (fs.existsSync(queueFile)) {
      try {
        const backupQueue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
        const current = this.automationStore.read();
        const existing = new Set(current.rows.map((row) => row.id));
        for (const row of Array.isArray(backupQueue.rows) ? backupQueue.rows : []) {
          if (existing.has(row.id)) { skippedRows += 1; continue; }
          current.rows.push({ ...row, status: row.status === 'running' ? 'paused' : row.status, updatedAt: new Date().toISOString() });
          existing.add(row.id);
          restoredRows += 1;
        }
        current.state = 'paused';
        current.recovery = {
          type: 'backup-restore',
          message: `Merged workspace backup from ${path.basename(backupDir)}.`,
          at: new Date().toISOString()
        };
        this.automationStore.write(current);
      } catch {
        throw new Error('Projects were restored, but the Automation List in this backup is unreadable.');
      }
    }

    return { ok: true, manifest, restoredProjects, skippedProjects, restoredRows, skippedRows };
  }

  healthCheck() {
    const errors = [];
    const warnings = [];
    const allProjects = this.projects.list({ includeArchived: true });
    const ids = new Set(allProjects.map((project) => project.id));
    const pathFields = ['referencePath', 'generatedImagePath', 'vectorPath', 'finalPngPath'];

    for (const project of allProjects) {
      for (const field of pathFields) {
        if (project[field] && !fs.existsSync(project[field])) warnings.push(`${project.id}: missing ${field} (${path.basename(project[field])})`);
      }
      if (!project.id || !project.status) errors.push(`${project.id || 'unknown project'}: invalid project metadata.`);
    }

    let queue;
    try { queue = this.automationStore.read(); }
    catch (error) {
      errors.push(`Automation List could not be read: ${error.message}`);
      queue = { rows: [], state: 'unknown' };
    }
    for (const row of queue.rows) {
      if (row.projectId && !ids.has(row.projectId)) warnings.push(`Automation row ${row.id} links to missing project ${row.projectId}.`);
      if (row.status === 'running' && queue.state !== 'running') warnings.push(`Automation row ${row.id} is marked running while queue state is ${queue.state}.`);
    }

    return {
      ok: errors.length === 0,
      checkedAt: new Date().toISOString(),
      projectCount: allProjects.length,
      archivedCount: allProjects.filter((p) => p.archivedAt).length,
      queueRowCount: queue.rows.length,
      queueState: queue.state,
      errors,
      warnings
    };
  }

  exportDiagnostics(destinationRoot) {
    const report = this.healthCheck();
    const projects = this.projects.list({ includeArchived: true }).map((project) => ({
      id: project.id,
      status: project.status,
      archived: Boolean(project.archivedAt),
      hasReference: Boolean(project.referencePath && fs.existsSync(project.referencePath)),
      hasGeneratedImage: Boolean(project.generatedImagePath && fs.existsSync(project.generatedImagePath)),
      hasVector: Boolean(project.vectorPath && fs.existsSync(project.vectorPath)),
      hasFinalPng: Boolean(project.finalPngPath && fs.existsSync(project.finalPngPath)),
      hasMetadata: Boolean(project.metadata),
      qualityOk: project.qualityCheck?.ok ?? null,
      updatedAt: project.updatedAt
    }));
    const queue = this.automationStore.read();
    const diagnostics = {
      format: 'ZeroPOD Diagnostics',
      version: 1,
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      health: report,
      projects,
      automation: {
        state: queue.state,
        rowCount: queue.rows.length,
        statuses: queue.rows.reduce((acc, row) => { acc[row.status || 'unknown'] = (acc[row.status || 'unknown'] || 0) + 1; return acc; }, {})
      },
      privacy: 'No passwords, cookies, browser profiles, full file paths, or source URLs are included.'
    };
    const file = path.join(destinationRoot, `ZeroPOD-Diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(diagnostics, null, 2), 'utf8');
    return { ok: true, path: file, report };
  }
}

module.exports = { WorkspaceManager };
