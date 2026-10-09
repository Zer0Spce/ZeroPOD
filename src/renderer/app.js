const navButtons = document.querySelectorAll('.nav');
const views = document.querySelectorAll('.view');
const serviceOrder = ['chatgpt', 'vectorizer', 'redbubble'];
let currentProjectId = null;
let projectFilter = 'all';

function setView(id) {
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  views.forEach((view) => view.classList.toggle('active-view', view.id === id));
}

navButtons.forEach((button) => button.addEventListener('click', async () => {
  setView(button.dataset.view);
  if (button.dataset.view === 'dashboard') await renderDashboard();
  if (button.dataset.view === 'projects') await renderProjects();
  if (button.dataset.view === 'review') await refreshReview();
  if (button.dataset.view === 'workflow') await refreshWorkflow();
  if (button.dataset.view === 'upload') await refreshUpload();
}));

function formatDate(value) {
  if (!value) return 'Never';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function setButton(id, enabled, label) {
  const button = document.getElementById(id);
  if (!button) return;
  button.disabled = !enabled;
  if (label) button.textContent = label;
}

function nextText(project) {
  return project.workflow?.next ? ` · Next: ${project.workflow.next}` : '';
}

function queueLabel(queue) {
  return ({ active: 'Active', attention: 'Needs Attention', review: 'Review', upload: 'Upload', completed: 'Completed' })[queue] || 'Active';
}

function projectCard(project, compact = false) {
  const flow = project.workflow || {};
  const progress = Number.isFinite(flow.progress) ? flow.progress : 0;
  return `<article class="project-card ${compact ? 'project-card-compact' : ''}">
    <div class="project-card-main">
      <div class="project-card-top"><div class="service-name">${project.id}</div><span class="stage-badge queue-${flow.queue || 'active'}">${flow.label || project.status}</span></div>
      <div class="last-seen">${flow.next || 'Review project'} · Updated ${formatDate(project.updatedAt)}</div>
      <div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><strong>${progress}%</strong></div>
    </div>
    <button class="continue-project" data-id="${project.id}">Continue</button>
  </article>`;
}

async function routeProject(project) {
  const view = project.workflow?.view || 'projects';
  setView(view);
  if (view === 'review') await refreshReview();
  else if (view === 'workflow') await refreshWorkflow();
  else if (view === 'upload') await refreshUpload();
  else await renderProjects();
}

function wireContinueButtons(root) {
  root.querySelectorAll('.continue-project').forEach((button) => button.addEventListener('click', async () => {
    currentProjectId = button.dataset.id;
    const project = await window.zeroPOD.projects.get(currentProjectId);
    await routeProject(project);
  }));
}

async function renderDashboard() {
  const projects = await window.zeroPOD.projects.list();
  const counts = projects.reduce((acc, project) => {
    const q = project.workflow?.queue || 'active';
    acc[q] = (acc[q] || 0) + 1;
    return acc;
  }, {});
  const stats = [
    ['Total Projects', projects.length],
    ['Active', counts.active || 0],
    ['Needs Attention', counts.attention || 0],
    ['Ready for Review', counts.review || 0],
    ['Upload Queue', counts.upload || 0],
    ['Published', counts.completed || 0]
  ];
  document.getElementById('dashboardStats').innerHTML = stats.map(([label, value]) => `<article class="stat-card"><strong>${value}</strong><span>${label}</span></article>`).join('');

  const attention = projects.filter((project) => ['attention', 'review'].includes(project.workflow?.queue)).slice(0, 5);
  const recent = projects.filter((project) => project.workflow?.queue !== 'completed').slice(0, 5);
  const attentionRoot = document.getElementById('attentionQueue');
  const recentRoot = document.getElementById('recentQueue');
  attentionRoot.innerHTML = attention.length ? attention.map((project) => projectCard(project, true)).join('') : '<div class="empty small-empty">Nothing needs attention right now.</div>';
  recentRoot.innerHTML = recent.length ? recent.map((project) => projectCard(project, true)).join('') : '<div class="empty small-empty">No active projects yet.</div>';
  wireContinueButtons(attentionRoot);
  wireContinueButtons(recentRoot);
}

async function renderConnections() {
  const statuses = await window.zeroPOD.connections.list();
  const root = document.getElementById('connectionCards');
  root.innerHTML = '';
  for (const id of serviceOrder) {
    const service = statuses[id];
    const card = document.createElement('article');
    card.className = 'connection-card';
    card.innerHTML = `<div><div class="service-name">${service.name}</div><div class="status ${service.connected ? 'connected' : ''}">${service.connected ? 'Session saved locally' : 'Not connected'}</div><div class="last-seen">Last session: ${formatDate(service.lastConnectedAt)}</div></div><div class="button-row"><button class="login" data-id="${id}">${service.connected ? 'Open / Reconnect' : 'Login'}</button><button class="logout secondary" data-id="${id}" ${service.connected ? '' : 'disabled'}>Logout</button></div>`;
    root.appendChild(card);
  }
  root.querySelectorAll('.login').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Opening…';
    try { await window.zeroPOD.connections.login(button.dataset.id); }
    catch (error) { alert(`Could not open login window: ${error.message || error}`); }
    finally { button.disabled = false; button.textContent = 'Open / Reconnect'; }
  }));
  root.querySelectorAll('.logout').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Clear this local ZeroPOD browser session? You will need to sign in again.')) return;
    await window.zeroPOD.connections.logout(button.dataset.id);
    await renderConnections();
  }));
}

async function renderRules() {
  const rules = await window.zeroPOD.pod.rules();
  document.getElementById('podRules').innerHTML = rules.map((rule) => `<li>${rule}</li>`).join('');
}

async function renderProjects() {
  const projects = await window.zeroPOD.projects.list();
  const root = document.getElementById('projectList');
  const filtered = projectFilter === 'all' ? projects : projects.filter((project) => project.workflow?.queue === projectFilter);
  if (!filtered.length) { root.innerHTML = `<div class="empty">No ${projectFilter === 'all' ? '' : queueLabel(projectFilter).toLowerCase()} projects.</div>`; return; }
  root.innerHTML = filtered.map((project) => projectCard(project)).join('');
  wireContinueButtons(root);
}

async function refreshReview() {
  if (!currentProjectId) {
    const projects = await window.zeroPOD.projects.list();
    const candidate = projects.find((item) => item.workflow?.view === 'review');
    if (candidate) currentProjectId = candidate.id;
  }
  if (!currentProjectId) return;
  const project = await window.zeroPOD.projects.get(currentProjectId);
  document.getElementById('reviewProjectLabel').textContent = project.id;
  const recoveryText = project.chatgptError?.recovery ? ` · Recovery: ${project.chatgptError.recovery}` : '';
  document.getElementById('reviewStatus').textContent = `Status: ${project.workflow?.label || project.status}${nextText(project)}${recoveryText}`;
  document.getElementById('reviewNotes').value = project.review?.notes || '';
  setButton('rejectDesign', project.status === 'awaiting-review');
  setButton('passDesign', project.status === 'awaiting-review');
  const img = document.getElementById('reviewImage');
  const message = document.getElementById('previewMessage');
  if (project.generatedImagePath) {
    img.src = `file:///${project.generatedImagePath.replace(/\\/g, '/')}`;
    img.hidden = false; message.hidden = true;
  } else {
    img.hidden = true; message.hidden = false;
    if (project.status === 'generating' || project.status === 'regenerating') message.textContent = 'ChatGPT is generating. ZeroPOD is waiting for the image download.';
    else if (project.status === 'chatgpt-recovery-needed') message.textContent = project.chatgptError?.recovery || 'ChatGPT needs attention. Open the saved session and retry.';
    else message.textContent = 'Generated image is not available yet.';
  }
}

async function refreshWorkflow() {
  if (!currentProjectId) {
    const projects = await window.zeroPOD.projects.list();
    const candidate = projects.find((item) => item.workflow?.view === 'workflow');
    if (candidate) currentProjectId = candidate.id;
  }
  if (!currentProjectId) return;
  const project = await window.zeroPOD.projects.get(currentProjectId);
  document.getElementById('workflowProjectLabel').textContent = project.id;
  const metaRecovery = project.metadataError?.recovery ? ` · Recovery: ${project.metadataError.recovery}` : '';
  document.getElementById('workflowStatus').textContent = `Status: ${project.workflow?.label || project.status}${nextText(project)}${metaRecovery}`;
  const meta = project.metadata || {};
  document.getElementById('metaTitle').value = meta.title || '';
  document.getElementById('metaMainTag').value = meta.mainTag || '';
  document.getElementById('metaSupportingTags').value = (meta.supportingTags || []).join(', ');
  document.getElementById('metaDescription').value = meta.description || '';
  setButton('generateMetadata', ['approved-image', 'metadata-recovery-needed', 'metadata-ready'].includes(project.status), project.status === 'metadata-recovery-needed' ? 'Retry Metadata' : 'Generate Metadata');
  setButton('startVectorizer', ['metadata-ready', 'vectorizer-recovery-needed'].includes(project.status), project.status === 'vectorizer-recovery-needed' ? 'Retry Vectorizer' : 'Vectorize');
  setButton('exportPng', project.status === 'vector-ready');
}

async function refreshUpload() {
  if (!currentProjectId) {
    const projects = await window.zeroPOD.projects.list();
    const candidate = projects.find((item) => item.workflow?.view === 'upload');
    if (candidate) currentProjectId = candidate.id;
  }
  if (!currentProjectId) return;
  const project = await window.zeroPOD.projects.get(currentProjectId);
  document.getElementById('uploadProjectLabel').textContent = project.id;
  document.getElementById('uploadStatus').textContent = `Status: ${project.workflow?.label || project.status}${nextText(project)}${project.redbubble?.publishedAt ? ` · Published ${formatDate(project.redbubble.publishedAt)}` : ''}`;
  const recovery = document.getElementById('uploadRecovery');
  recovery.textContent = project.lastAutomationError ? `Recovery: ${project.lastAutomationError.recovery} Last error: ${project.lastAutomationError.message}` : '';
  setButton('prepareRedbubble', ['export-ready', 'redbubble-recovery-needed'].includes(project.status), project.status === 'redbubble-recovery-needed' ? 'Retry Redbubble' : 'Prepare Redbubble');
  setButton('publishRedbubble', project.status === 'redbubble-review');
}

document.getElementById('dashboardNewDesign').addEventListener('click', () => setView('create'));
document.querySelectorAll('.project-filter').forEach((button) => button.addEventListener('click', async () => {
  projectFilter = button.dataset.filter;
  document.querySelectorAll('.project-filter').forEach((item) => item.classList.toggle('active-filter', item === button));
  await renderProjects();
}));

document.getElementById('chooseReference').addEventListener('click', async () => {
  const file = await window.zeroPOD.files.chooseReference();
  if (file) document.getElementById('referencePath').value = file;
});

document.getElementById('startGeneration').addEventListener('click', async () => {
  const reference = document.getElementById('referencePath').value.trim();
  const sourceUrl = document.getElementById('sourceUrl').value.trim();
  const status = document.getElementById('generationStatus');
  if (!reference) { status.textContent = 'Choose a reference image first.'; return; }
  const button = document.getElementById('startGeneration');
  button.disabled = true; status.textContent = 'Opening ChatGPT and submitting the ZeroPOD generation job…';
  try {
    const result = await window.zeroPOD.generation.start({ referencePath: reference, sourceUrl });
    currentProjectId = result.projectId;
    status.textContent = result.message;
    setView('review'); await refreshReview();
  } catch (error) { status.textContent = `Generation could not start: ${error.message || error}`; }
  finally { button.disabled = false; }
});

document.getElementById('rejectDesign').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No project selected.');
  const notes = document.getElementById('reviewNotes').value.trim();
  document.getElementById('reviewStatus').textContent = 'Submitting regeneration…';
  try { await window.zeroPOD.review.reject({ projectId: currentProjectId, notes }); await refreshReview(); }
  catch (error) { alert(`Regeneration failed: ${error.message || error}`); }
});

document.getElementById('passDesign').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No project selected.');
  try { await window.zeroPOD.review.pass({ projectId: currentProjectId }); await routeProject(await window.zeroPOD.projects.get(currentProjectId)); }
  catch (error) { alert(error.message || error); }
});

document.getElementById('generateMetadata').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No approved project selected.');
  const button = document.getElementById('generateMetadata'); button.disabled = true;
  document.getElementById('workflowStatus').textContent = 'Generating POD WINNER metadata in ChatGPT…';
  try { await window.zeroPOD.metadata.generate(currentProjectId); }
  catch (error) { document.getElementById('workflowStatus').textContent = `Metadata needs attention: ${error.message || error}`; }
  finally { button.disabled = false; await refreshWorkflow(); }
});

document.getElementById('startVectorizer').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No project selected.');
  document.getElementById('workflowStatus').textContent = 'Opening Vectorizer.ai and uploading the approved image…';
  try { const result = await window.zeroPOD.vectorizer.start(currentProjectId); document.getElementById('workflowStatus').textContent = result.message; await refreshWorkflow(); }
  catch (error) { alert(`Vectorization failed: ${error.message || error}`); await refreshWorkflow(); }
});

document.getElementById('exportPng').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No project selected.');
  document.getElementById('workflowStatus').textContent = 'Exporting transparent 4500×5400 PNG…';
  try { const result = await window.zeroPOD.export.png(currentProjectId); document.getElementById('workflowStatus').textContent = `Export ready: ${result.path}`; await routeProject(await window.zeroPOD.projects.get(currentProjectId)); }
  catch (error) { alert(`Export failed: ${error.message || error}`); }
});

document.getElementById('prepareRedbubble').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No export-ready project selected.');
  const status = document.getElementById('uploadStatus'); const button = document.getElementById('prepareRedbubble');
  button.disabled = true; status.textContent = 'Opening Redbubble, copying the first existing work, and replacing artwork + metadata…';
  try { const result = await window.zeroPOD.redbubble.prepare(currentProjectId); status.textContent = result.message; }
  catch (error) { status.textContent = `Redbubble needs attention: ${error.message || error}`; }
  finally { button.disabled = false; await refreshUpload(); }
});

document.getElementById('publishRedbubble').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No Redbubble project selected.');
  if (!confirm('Publish/save this copied Redbubble work now? Confirm that the artwork, inherited product settings, title, tags, description, and product configuration look correct.')) return;
  try { await window.zeroPOD.redbubble.publish(currentProjectId); await refreshUpload(); await renderDashboard(); }
  catch (error) { alert(`Redbubble publish failed: ${error.message || error}`); }
});

renderConnections();
renderRules();
renderProjects();
renderDashboard();
