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
      version: 1,
      createdAt: new Date().toISOString(),
      projectCount: this.projects.list({ includeArchived: true }).length,
      includes: ['projects', 'automation-list'],
      excludes: ['browser session profiles', 'passwords', 'cookies', 'credentials'],
      note: 'Browser login sessions are intentionally excluded from backups.'
    };
    fs.writeFileSync(path.join(backupDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: true, path: backupDir, manifest };
  }
}

module.exports = { WorkspaceManager };
