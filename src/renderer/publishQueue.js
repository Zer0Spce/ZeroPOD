let publishQueuePoll = null;

function publishEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function publishFileUrl(filePath) {
  return `file:///${String(filePath || '').replace(/\\/g, '/')}`;
}

function ensurePublishQueue() {
  const section = document.getElementById('upload');
  if (!section || document.getElementById('finalPublishQueue')) return;

  const style = document.createElement('style');
  style.textContent = `
    .publish-queue-panel{margin:18px 0 22px;padding:16px;background:#171b21;border:1px solid #262d38;border-radius:14px}
    .publish-queue-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px}.publish-queue-head strong{font-size:17px}
    .publish-queue-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
    .publish-card{background:#11151a;border:1px solid #303744;border-radius:12px;padding:10px;display:grid;gap:9px}.publish-card.selected{outline:2px solid #6875ff;border-color:#6875ff}
    .publish-card img{width:100%;aspect-ratio:5/6;object-fit:contain;background:#0b0d10;border-radius:8px}.publish-card-title{font-weight:700;line-height:1.3}.publish-card-meta{font-size:11px;color:#8f99a8;line-height:1.45}.publish-card-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .qc-good{color:#85ddb0}.qc-warn{color:#e9d27a}.qc-bad{color:#ff9ba5}
    .project-timeline{margin:18px 0 0;border-top:1px solid #2a313c;padding-top:14px}.timeline-list{display:grid;gap:8px;margin-top:10px;max-height:260px;overflow:auto}.timeline-item{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 10px;background:#0f1318;border-radius:9px}.timeline-time{font-size:11px;color:#778292}.timeline-label{font-size:12px;color:#c8ced8}.publish-empty{padding:16px;color:#788394}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'finalPublishQueue';
  panel.className = 'publish-queue-panel';
  panel.innerHTML = `<div class="publish-queue-head"><div><strong>Final Publish Queue</strong><div id="publishQueueCount" class="last-seen">0 projects ready</div></div><button id="refreshPublishQueue">Refresh</button></div><div id="publishQueueGrid" class="publish-queue-grid"></div><div id="projectTimeline" class="project-timeline"></div>`;
  const firstPanel = section.querySelector('.panel');
  section.insertBefore(panel, firstPanel || section.lastChild);
  document.getElementById('refreshPublishQueue').addEventListener('click', () => renderPublishQueue().catch(() => {}));
}

function publishStatusText(project) {
  return project.workflow?.label || project.status;
}

function qualityText(project) {
  if (!project.qualityCheck) return { label: 'QC not run', cls: 'qc-warn' };
  return project.qualityCheck.ok ? { label: 'QC passed', cls: 'qc-good' } : { label: 'QC failed', cls: 'qc-bad' };
}

function renderTimeline(project) {
  const root = document.getElementById('projectTimeline');
  if (!root) return;
  if (!project) {
    root.innerHTML = '<div class="publish-empty">Select a publish project to view its activity timeline.</div>';
    return;
  }
  const activity = Array.isArray(project.activity) ? [...project.activity].reverse().slice(0, 50) : [];
  const items = activity.length ? activity : [{ at: project.updatedAt, label: `Current status: ${publishStatusText(project)}` }];
  root.innerHTML = `<div class="publish-queue-head"><div><strong>Project Activity</strong><div class="last-seen">${publishEscape(project.id)}</div></div></div><div class="timeline-list">${items.map((item) => `<div class="timeline-item"><div class="timeline-time">${publishEscape(formatDate(item.at))}</div><div class="timeline-label">${publishEscape(item.label || item.to || item.type || 'Event')}</div></div>`).join('')}</div>`;
}

async function selectPublishProject(projectId) {
  currentProjectId = projectId;
  await refreshUpload();
  const project = await window.zeroPOD.projects.get(projectId);
  renderTimeline(project);
  await renderPublishQueue(false);
}

async function renderPublishQueue(refreshTimeline = true) {
  ensurePublishQueue();
  const root = document.getElementById('publishQueueGrid');
  if (!root) return;
  const projects = await window.zeroPOD.projects.list();
  const allowed = new Set(['export-ready', 'redbubble-preparing', 'redbubble-recovery-needed', 'redbubble-review', 'redbubble-publish-pending', 'published']);
  const queue = projects.filter((project) => allowed.has(project.status));
  const openCount = queue.filter((project) => project.status !== 'published').length;
  document.getElementById('publishQueueCount').textContent = `${openCount} project${openCount === 1 ? '' : 's'} awaiting publish completion · ${queue.filter((p) => p.status === 'published').length} published`;

  if (!queue.length) {
    root.innerHTML = '<div class="publish-empty">Nothing has reached the final publish stages yet.</div>';
    if (refreshTimeline) renderTimeline(null);
    return;
  }

  root.innerHTML = queue.map((project) => {
    const qc = qualityText(project);
    const title = project.metadata?.title || project.id;
    const pending = project.status === 'redbubble-publish-pending';
    const published = project.status === 'published';
    const action = published ? 'View' : pending ? 'Verify / Review' : 'Open Review';
    return `<article class="publish-card ${project.id === currentProjectId ? 'selected' : ''}" data-id="${publishEscape(project.id)}">
      ${project.finalPngPath ? `<img src="${publishEscape(publishFileUrl(project.finalPngPath))}" alt="Final PNG">` : '<div class="preview-placeholder">No final PNG</div>'}
      <div class="publish-card-title">${publishEscape(title)}</div>
      <div class="publish-card-row"><span class="stage-badge queue-${publishEscape(project.workflow?.queue || 'upload')}">${publishEscape(publishStatusText(project))}</span><span class="${qc.cls}">${qc.label}</span></div>
      <div class="publish-card-meta">${publishEscape(project.sourceUrl || 'No source URL')}${project.redbubble?.publishedUrl ? '<br>Published URL verified' : ''}</div>
      <button class="publish-open ${pending ? 'primary' : ''}">${action}</button>
    </article>`;
  }).join('');

  root.querySelectorAll('.publish-card').forEach((card) => {
    card.querySelector('.publish-open').addEventListener('click', () => selectPublishProject(card.dataset.id).catch((error) => alert(error.message || error)));
  });

  if (refreshTimeline) {
    const selected = queue.find((project) => project.id === currentProjectId) || queue[0];
    if (selected) {
      if (!currentProjectId) currentProjectId = selected.id;
      renderTimeline(selected);
    }
  }
}

function startPublishQueuePolling() {
  if (publishQueuePoll) return;
  publishQueuePoll = setInterval(() => {
    if (document.getElementById('upload')?.classList.contains('active-view')) renderPublishQueue().catch(() => {});
  }, 3500);
}

const uploadNavForPublishQueue = document.querySelector('.nav[data-view="upload"]');
uploadNavForPublishQueue?.addEventListener('click', () => setTimeout(() => renderPublishQueue().catch(() => {}), 50));

ensurePublishQueue();
startPublishQueuePolling();
renderPublishQueue().catch(() => {});
