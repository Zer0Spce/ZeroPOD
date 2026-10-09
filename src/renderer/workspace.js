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
    <button id="workspaceBackup" class="secondary">Export Workspace Backup</button>
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
  document.getElementById('workspaceBackup').addEventListener('click', async () => {
    const button = document.getElementById('workspaceBackup');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Exporting…';
    try {
      const result = await window.zeroPOD.workspace.backup();
      if (!result.canceled) alert(`Workspace backup created successfully.\n\n${result.path}\n\nBrowser login sessions and credentials were intentionally excluded.`);
    } catch (error) {
      alert(`Backup failed: ${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
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
      const source = document.createElement('div');
      source.className = 'workspace-source';
      source.textContent = project.sourceUrl;
      main?.appendChild(source);
    }

    if (!card.querySelector('.workspace-archive')) {
      const actions = document.createElement('div');
      actions.className = 'workspace-actions';
      const archive = document.createElement('button');
      archive.className = 'workspace-archive secondary';
      archive.textContent = 'Archive';
      archive.addEventListener('click', async () => {
        if (!confirm('Archive this project? Its files stay on this PC and you can restore it later.')) return;
        try {
          await window.zeroPOD.projects.archive(projectId);
          if (typeof renderProjects === 'function') await renderProjects();
          await enhanceActiveProjectCards();
          if (showArchivedProjects) await renderArchivedProjects();
        } catch (error) { alert(error.message || error); }
      });
      actions.appendChild(archive);
      card.appendChild(actions);
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
  if (!projects.length) {
    root.innerHTML = '<div class="empty">No archived projects.</div>';
    return;
  }

  root.innerHTML = '';
  for (const project of projects) {
    const card = document.createElement('article');
    card.className = 'project-card archived-card';
    card.dataset.workspaceSearch = [project.id, project.status, project.sourceUrl, project.metadata?.title, project.workflow?.label].filter(Boolean).join(' ').toLowerCase();
    const title = project.metadata?.title || project.id;
    card.innerHTML = `
      <div class="project-card-main">
        <div class="project-card-top"><div class="service-name"></div><span class="stage-badge">Archived</span></div>
        <div class="last-seen"></div>
        <div class="workspace-source"></div>
      </div>
      <div class="workspace-actions"><button class="restore-project">Restore</button><button class="delete-project danger">Delete Permanently</button></div>`;
    card.querySelector('.service-name').textContent = title;
    card.querySelector('.last-seen').textContent = `${project.workflow?.label || project.status} · Archived ${formatDate(project.archivedAt)}`;
    card.querySelector('.workspace-source').textContent = project.sourceUrl || project.id;
    card.querySelector('.restore-project').addEventListener('click', async () => {
      try {
        await window.zeroPOD.projects.restore(project.id);
        await renderArchivedProjects();
        if (typeof renderProjects === 'function') await renderProjects();
        await enhanceActiveProjectCards();
      } catch (error) { alert(error.message || error); }
    });
    card.querySelector('.delete-project').addEventListener('click', async () => {
      if (!confirm(`Permanently delete project ${project.id} and all of its local artwork/files? This cannot be undone.`)) return;
      if (!confirm('Final confirmation: permanently delete this project?')) return;
      try {
        await window.zeroPOD.projects.delete(project.id);
        await renderArchivedProjects();
      } catch (error) { alert(error.message || error); }
    });
    root.appendChild(card);
  }
  filterWorkspaceCards();
}

function ensureDuplicateWarning() {
  const sourceInput = document.getElementById('sourceUrl');
  if (!sourceInput || document.getElementById('duplicateSourceWarning')) return;
  const warning = document.createElement('div');
  warning.id = 'duplicateSourceWarning';
  warning.className = 'workspace-warning';
  warning.hidden = true;
  sourceInput.parentNode.appendChild(warning);

  sourceInput.addEventListener('input', () => {
    clearTimeout(duplicateTimer);
    duplicateTimer = setTimeout(async () => {
      const value = sourceInput.value.trim();
      if (!value) { warning.hidden = true; return; }
      try {
        const matches = await window.zeroPOD.projects.duplicates(value);
        if (!matches.length) { warning.hidden = true; return; }
        warning.textContent = `Duplicate source warning: ${matches.length} existing project${matches.length === 1 ? '' : 's'} already use this Amazon/source URL. You can still continue if this is intentional.`;
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

injectWorkspaceStyles();
ensureWorkspaceControls();
ensureDuplicateWarning();
observeProjectRendering();
enhanceActiveProjectCards().catch(() => {});
