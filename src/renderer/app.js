const navButtons = document.querySelectorAll('.nav');
const views = document.querySelectorAll('.view');
const serviceOrder = ['chatgpt', 'vectorizer', 'redbubble'];
let currentProjectId = null;

function setView(id) {
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  views.forEach((view) => view.classList.toggle('active-view', view.id === id));
}

navButtons.forEach((button) => button.addEventListener('click', async () => {
  setView(button.dataset.view);
  if (button.dataset.view === 'projects') await renderProjects();
  if (button.dataset.view === 'review') await refreshReview();
  if (button.dataset.view === 'workflow') await refreshWorkflow();
}));

function formatDate(value) {
  if (!value) return 'Never';
  try { return new Date(value).toLocaleString(); } catch { return value; }
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
  if (!projects.length) { root.innerHTML = '<div class="empty">No local projects yet.</div>'; return; }
  root.innerHTML = projects.map((project) => `<article class="connection-card"><div><div class="service-name">${project.id}</div><div class="status">${project.status}</div><div class="last-seen">Updated: ${formatDate(project.updatedAt)}</div></div><button class="open-project" data-id="${project.id}">Open</button></article>`).join('');
  root.querySelectorAll('.open-project').forEach((button) => button.addEventListener('click', async () => {
    currentProjectId = button.dataset.id;
    const project = await window.zeroPOD.projects.get(currentProjectId);
    setView(project.review?.decision === 'passed' ? 'workflow' : 'review');
    if (project.review?.decision === 'passed') await refreshWorkflow(); else await refreshReview();
  }));
}

async function refreshReview() {
  if (!currentProjectId) {
    const projects = await window.zeroPOD.projects.list();
    const candidate = projects.find((item) => ['awaiting-review', 'generating', 'regenerating'].includes(item.status));
    if (candidate) currentProjectId = candidate.id;
  }
  if (!currentProjectId) return;
  const project = await window.zeroPOD.projects.get(currentProjectId);
  document.getElementById('reviewProjectLabel').textContent = project.id;
  document.getElementById('reviewStatus').textContent = `Status: ${project.status}`;
  document.getElementById('reviewNotes').value = project.review?.notes || '';
  const img = document.getElementById('reviewImage');
  const message = document.getElementById('previewMessage');
  if (project.generatedImagePath) {
    img.src = `file:///${project.generatedImagePath.replace(/\\/g, '/')}`;
    img.hidden = false; message.hidden = true;
  } else {
    img.hidden = true; message.hidden = false;
    message.textContent = project.status === 'generating' ? 'ChatGPT is generating. Return here after the image has downloaded.' : 'Generated image is not available yet.';
  }
}

async function refreshWorkflow() {
  if (!currentProjectId) {
    const projects = await window.zeroPOD.projects.list();
    const candidate = projects.find((item) => item.review?.decision === 'passed');
    if (candidate) currentProjectId = candidate.id;
  }
  if (!currentProjectId) return;
  const project = await window.zeroPOD.projects.get(currentProjectId);
  document.getElementById('workflowProjectLabel').textContent = project.id;
  document.getElementById('workflowStatus').textContent = `Status: ${project.status}`;
  const meta = project.metadata || {};
  document.getElementById('metaTitle').value = meta.title || '';
  document.getElementById('metaMainTag').value = meta.mainTag || '';
  document.getElementById('metaSupportingTags').value = (meta.supportingTags || []).join(', ');
  document.getElementById('metaDescription').value = meta.description || '';
}

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
    setView('review');
    await refreshReview();
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
  await window.zeroPOD.review.pass({ projectId: currentProjectId });
  setView('workflow');
  await refreshWorkflow();
});

document.getElementById('generateMetadata').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No approved project selected.');
  document.getElementById('workflowStatus').textContent = 'Generating Redbubble metadata in ChatGPT…';
  try { await window.zeroPOD.metadata.generate(currentProjectId); await refreshWorkflow(); }
  catch (error) { alert(`Metadata generation failed: ${error.message || error}`); }
});

document.getElementById('startVectorizer').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No project selected.');
  document.getElementById('workflowStatus').textContent = 'Opening Vectorizer.ai and uploading the approved image…';
  try { const result = await window.zeroPOD.vectorizer.start(currentProjectId); document.getElementById('workflowStatus').textContent = result.message; }
  catch (error) { alert(`Vectorization failed: ${error.message || error}`); }
});

document.getElementById('exportPng').addEventListener('click', async () => {
  if (!currentProjectId) return alert('No project selected.');
  document.getElementById('workflowStatus').textContent = 'Exporting transparent 4500×5400 PNG…';
  try { const result = await window.zeroPOD.export.png(currentProjectId); document.getElementById('workflowStatus').textContent = `Export ready: ${result.path}`; }
  catch (error) { alert(`Export failed: ${error.message || error}`); }
});

renderConnections();
renderRules();
renderProjects();
