let workspaceProjectSearch = '';
let showArchivedProjects = false;
let projectEnhanceObserver = null;
let duplicateTimer = null;

function injectWorkspaceStyles() {
  if (document.getElementById('workspaceStyles')) return;
  const style = document.createElement('style');
  style.id = 'workspaceStyles';
  style.textContent = `
    .workspace-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0 18px}
    .workspace-search{min-width:280px;flex:1}
    .workspace-source{font-size:12px;opacity:.7;word-break:break-all;margin-top:5px}
    .workspace-actions{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
    .workspace-archived{margin-top:24px}
    .workspace-warning{margin-top:8px;padding:10px 12px;border-radius:8px;background:rgba(255,180,0,.12);border:1px solid rgba(255,180,0,.3)}
    .workspace-health{margin-top:14px;white-space:pre-wrap}
    .archived-card{opacity:.88}
  `;
  document.head.appendChild(style);
}

function ensureWorkspaceControls() {
  const section = document.getElementById('projects');
  const projectList = document.getElementById('projectList');
  if (!section || !projectList || document.getElementById('workspaceToolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.id = 'workspaceToolbar';
  toolbar.className = 'workspace-toolbar';
  toolbar.innerHTML = `
    <input id="workspaceProjectSearch" class="workspace-search" placeholder="Search project ID, title, source URL, or status…" />
    <button id="workspaceArchivedToggle">Archived Projects</button>
    <button id="workspaceBackup" class="secondary">Export Backup</button>
    <button id="workspaceRestore" class="secondary">Restore Backup</button>
  `;
  projectList.parentNode.insertBefore(toolbar, projectList);

  const archived = document.createElement('div');
  archived.id = 'workspaceArchivedPanel';
  archived.className = 'workspace-archived';
  archived.hidden = true;
  archived.innerHTML = '<div class="section-title"><h3>Archived Projects</h3><span>Restore or permanently delete old projects</span></div><div id="workspaceArchivedList" class="cards"></div>';
  projectList.parentNode.insertBefore(archived, projectList.nextSibling);

  document.getElementById('workspaceProjectSearch').addEventListener('input', (event) => {
    workspaceProjectSearch = event.target.value.trim().toLowerCase();
    filterWorkspaceCards();
  });
  document.getElementById('workspaceArchivedToggle').addEventListener('click', async () => {
    showArchivedProjects = !showArchivedProjects;
    archived.hidden = !showArchivedProjects;
    document.getElementById('workspaceArchivedToggle').textContent = showArchivedProjects ? 'Hide Archived' : 'Archived Projects';
    if (showArchivedProjects) await renderArchivedProjects();
  });
  document.getElementById('workspaceBackup').addEventListener('click', runWorkspaceBackup);
  document.getElementById('workspaceRestore').addEventListener('click', runWorkspaceRestore);
}

function ensureMaintenancePanel() {
  const settings = document.getElementById('settings');
  if (!settings || document.getElementById('workspaceMaintenance')) return;
  const panel = document.createElement('div');
  panel.id = 'workspaceMaintenance';
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="heading-row"><div><h3>Workspace Maintenance</h3><p class="muted">Backup/restore, local integrity checks, and privacy-safe diagnostics for the upcoming 1.0 testing phase.</p></div></div>
    <div class="button-row"><button id="settingsBackup">Export Backup</button><button id="settingsRestore">Restore Backup</button><button id="settingsHealth">Run Health Check</button><button id="settingsDiagnostics">Export Diagnostics</button></div>
    <div id="workspaceHealthResult" class="validation-box muted workspace-health">No workspace health check run yet.</div>
    <p class="muted">Backups and diagnostics intentionally exclude browser profiles, cookies, saved login sessions, passwords, and credentials.</p>`;
  settings.appendChild(panel);
  document.getElementById('settingsBackup').addEventListener('click', runWorkspaceBackup);
  document.getElementById('settingsRestore').addEventListener('click', runWorkspaceRestore);
  document.getElementById('settingsHealth').addEventListener('click', runHealthCheck);
  document.getElementById('settingsDiagnostics').addEventListener('click', exportDiagnostics);
}

async function runWorkspaceBackup() {
  try {
    const result = await window.zeroPOD.workspace.backup();
    if (!result.canceled) alert(`Workspace backup created successfully.\n\n${result.path}\n\nLogin sessions and credentials were excluded.`);
  } catch (error) { alert(`Backup failed: ${error.message || error}`); }
}

async function runWorkspaceRestore() {
  if (!confirm('Restore a ZeroPOD backup? Existing project IDs and queue row IDs will be kept; matching items from the backup will be skipped rather than overwritten.')) return;
  try {
    const result = await window.zeroPOD.workspace.restore();
    if (result.canceled) return;
    alert(`Backup merge complete.\n\nProjects restored: ${result.restoredProjects}\nProjects skipped: ${result.skippedProjects}\nQueue rows restored: ${result.restoredRows}\nQueue rows skipped: ${result.skippedRows}\n\nThe queue is paused after restore.`);
    if (typeof renderProjects === 'function') await renderProjects();
    await enhanceActiveProjectCards();
    if (showArchivedProjects) await renderArchivedProjects();
    if (typeof refreshAutomationList === 'function') await refreshAutomationList();
  } catch (error) { alert(`Restore failed: ${error.message || error}`); }
}

async function runHealthCheck() {
  const root = document.getElementById('workspaceHealthResult');
  try {
    const report = await window.zeroPOD.workspace.health();
    const lines = [
      `${report.ok ? 'Healthy' : 'Needs attention'} · ${report.projectCount} projects · ${report.queueRowCount} queue rows · queue ${report.queueState}`,
      `Warnings: ${report.warnings.length} · Errors: ${report.errors.length}`
    ];
    if (report.errors.length) lines.push(`\nErrors:\n- ${report.errors.join('\n- ')}`);
    if (report.warnings.length) lines.push(`\nWarnings:\n- ${report.warnings.slice(0, 20).join('\n- ')}${report.warnings.length > 20 ? '\n- …more warnings omitted' : ''}`);
    if (root) root.textContent = lines.join('\n');
  } catch (error) {
    if (root) root.textContent = `Health check failed: ${error.message || error}`;
  }
}

async function exportDiagnostics() {
  try {
    const result = await window.zeroPOD.workspace.diagnostics();
    if (!result.canceled) alert(`Diagnostics exported.\n\n${result.path}\n\nThe report excludes credentials, cookies, browser profiles, source URLs, and full file paths.`);
  } catch (error) { alert(`Diagnostics export failed: ${error.message || error}`); }
}

async function enhanceActiveProjectCards() {
  const root = document.getElementById('projectList');
  if (!root) return;
  const projects = await window.zeroPOD.projects.list();
  const byId = new Map(projects.map((project) => [project.id, project]));
  root.querySelectorAll('.project-card').forEach((card) => {
    const continueButton = card.querySelector('.continue-project');
    const projectId = continueButton?.dataset.id;
    if (!projectId) return;
    const project = byId.get(projectId);
    if (!project) return;
    card.dataset.workspaceSearch = [project.id, project.status, project.sourceUrl, project.metadata?.title, project.workflow?.label].filter(Boolean).join(' ').toLowerCase();
    if (!card.querySelector('.workspace-source') && project.sourceUrl) {
      const main = card.querySelector('.project-card-main');
      const source = document.createElement('div'); source.className = 'workspace-source'; source.textContent = project.sourceUrl; main?.appendChild(source);
    }
    if (!card.querySelector('.workspace-archive')) {
      const actions = document.createElement('div'); actions.className = 'workspace-actions';
      const archive = document.createElement('button'); archive.className = 'workspace-archive secondary'; archive.textContent = 'Archive';
      archive.addEventListener('click', async () => {
        if (!confirm('Archive this project? Its files stay on this PC and you can restore it later.')) return;
        try { await window.zeroPOD.projects.archive(projectId); if (typeof renderProjects === 'function') await renderProjects(); await enhanceActiveProjectCards(); if (showArchivedProjects) await renderArchivedProjects(); }
        catch (error) { alert(error.message || error); }
      });
      actions.appendChild(archive); card.appendChild(actions);
    }
  });
  filterWorkspaceCards();
}

function filterWorkspaceCards() {
  const query = workspaceProjectSearch;
  document.querySelectorAll('#projectList .project-card, #workspaceArchivedList .project-card').forEach((card) => {
    const haystack = card.dataset.workspaceSearch || card.textContent.toLowerCase();
    card.hidden = Boolean(query && !haystack.includes(query));
  });
}

async function renderArchivedProjects() {
  const root = document.getElementById('workspaceArchivedList');
  if (!root) return;
  const projects = await window.zeroPOD.projects.archived();
  if (!projects.length) { root.innerHTML = '<div class="empty">No archived projects.</div>'; return; }
  root.innerHTML = '';
  for (const project of projects) {
    const card = document.createElement('article'); card.className = 'project-card archived-card';
    card.dataset.workspaceSearch = [project.id, project.status, project.sourceUrl, project.metadata?.title, project.workflow?.label].filter(Boolean).join(' ').toLowerCase();
    card.innerHTML = '<div class="project-card-main"><div class="project-card-top"><div class="service-name"></div><span class="stage-badge">Archived</span></div><div class="last-seen"></div><div class="workspace-source"></div></div><div class="workspace-actions"><button class="restore-project">Restore</button><button class="delete-project danger">Delete Permanently</button></div>';
    card.querySelector('.service-name').textContent = project.metadata?.title || project.id;
    card.querySelector('.last-seen').textContent = `${project.workflow?.label || project.status} · Archived ${formatDate(project.archivedAt)}`;
    card.querySelector('.workspace-source').textContent = project.sourceUrl || project.id;
    card.querySelector('.restore-project').addEventListener('click', async () => { try { await window.zeroPOD.projects.restore(project.id); await renderArchivedProjects(); if (typeof renderProjects === 'function') await renderProjects(); await enhanceActiveProjectCards(); } catch (error) { alert(error.message || error); } });
    card.querySelector('.delete-project').addEventListener('click', async () => {
      if (!confirm(`Permanently delete project ${project.id} and all local artwork/files?`)) return;
      if (!confirm('Final confirmation: this cannot be undone.')) return;
      try { await window.zeroPOD.projects.delete(project.id); await renderArchivedProjects(); } catch (error) { alert(error.message || error); }
    });
    root.appendChild(card);
  }
  filterWorkspaceCards();
}

function ensureDuplicateWarning() {
  const sourceInput = document.getElementById('sourceUrl');
  if (!sourceInput || document.getElementById('duplicateSourceWarning')) return;
  const warning = document.createElement('div'); warning.id = 'duplicateSourceWarning'; warning.className = 'workspace-warning'; warning.hidden = true; sourceInput.parentNode.appendChild(warning);
  sourceInput.addEventListener('input', () => {
    clearTimeout(duplicateTimer);
    duplicateTimer = setTimeout(async () => {
      const value = sourceInput.value.trim(); if (!value) { warning.hidden = true; return; }
      try {
        const matches = await window.zeroPOD.projects.duplicates(value);
        if (!matches.length) { warning.hidden = true; return; }
        warning.textContent = `Duplicate source warning: ${matches.length} existing project${matches.length === 1 ? '' : 's'} already use this Amazon/source URL. You can still continue if intentional.`;
        warning.hidden = false;
      } catch { warning.hidden = true; }
    }, 350);
  });
}

function observeProjectRendering() {
  const root = document.getElementById('projectList');
  if (!root || projectEnhanceObserver) return;
  projectEnhanceObserver = new MutationObserver(() => { enhanceActiveProjectCards().catch(() => {}); });
  projectEnhanceObserver.observe(root, { childList: true });
}

function loadV09Polish() {
  if (!document.getElementById('v09ThemeCss')) {
    const link = document.createElement('link');
    link.id = 'v09ThemeCss';
    link.rel = 'stylesheet';
    link.href = 'theme.css';
    document.head.appendChild(link);
  }
  ['appearance.js', 'readiness.js'].forEach((src) => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement('script');
    script.src = src;
    document.body.appendChild(script);
  });
  const footer = document.querySelector('.footer-note');
  if (footer) footer.textContent = 'Windows only · v0.9-beta';
}

injectWorkspaceStyles();
ensureWorkspaceControls();
ensureMaintenancePanel();
ensureDuplicateWarning();
observeProjectRendering();
enhanceActiveProjectCards().catch(() => {});
loadV09Polish();
