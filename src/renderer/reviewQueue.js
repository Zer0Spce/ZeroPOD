let reviewQueueProjects = [];

function reviewEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function reviewFileUrl(filePath) {
  return `file:///${String(filePath || '').replace(/\\/g, '/')}`;
}

function ensureReviewGallery() {
  const section = document.getElementById('review');
  const layout = section?.querySelector('.review-layout');
  if (!section || !layout || document.getElementById('batchReviewPanel')) return;
  const style = document.createElement('style');
  style.textContent = `
    .batch-review-panel{margin:0 0 20px;padding:16px;background:#171b21;border:1px solid #262d38;border-radius:14px}
    .batch-review-header{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:12px}.batch-review-header strong{font-size:16px}.batch-review-actions{display:flex;gap:7px}
    .batch-review-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:12px;max-height:410px;overflow:auto}
    .batch-review-card{background:#11151a;border:1px solid #303744;border-radius:12px;padding:9px;display:grid;gap:8px;cursor:pointer}.batch-review-card.selected{outline:2px solid #6875ff;border-color:#6875ff}.batch-review-card img{width:100%;aspect-ratio:4/5;object-fit:contain;background:#0b0d10;border-radius:8px}.batch-review-card .source{font-size:10px;color:#8d97a7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.batch-review-card .notes{font-size:11px;color:#c0c7d2;min-height:28px}.batch-review-card .card-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.batch-review-card button{padding:7px;font-size:11px}.batch-review-empty{color:#788394;padding:14px}
  `;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.id = 'batchReviewPanel';
  panel.className = 'batch-review-panel';
  panel.innerHTML = `<div class="batch-review-header"><div><strong>Batch Review</strong><div id="batchReviewCount" class="last-seen">0 designs waiting</div></div><div class="batch-review-actions"><button id="reviewPrevious">← Previous</button><button id="reviewNext">Next →</button></div></div><div id="batchReviewGrid" class="batch-review-grid"></div>`;
  section.insertBefore(panel, layout);
  document.getElementById('reviewPrevious').addEventListener('click', () => moveReviewSelection(-1));
  document.getElementById('reviewNext').addEventListener('click', () => moveReviewSelection(1));
}

function ensureV105Controls() {
  const footer = document.querySelector('.footer-note');
  if (footer) footer.textContent = footer.textContent.replace(/v\d+\.\d+\.\d+/, 'v1.0.5');

  const startButton = document.getElementById('startGeneration');
  if (!startButton || document.getElementById('newChatButton')) return;
  const newChatButton = document.createElement('button');
  newChatButton.id = 'newChatButton';
  newChatButton.className = 'secondary';
  newChatButton.textContent = 'NEW CHAT';
  newChatButton.style.marginLeft = '8px';
  startButton.insertAdjacentElement('afterend', newChatButton);
  newChatButton.addEventListener('click', async () => {
    const status = document.getElementById('generationStatus');
    newChatButton.disabled = true;
    if (status) status.textContent = 'Opening a fresh ChatGPT conversation…';
    try {
      const result = await window.zeroPOD.generation.newChat();
      if (status) status.textContent = result.message;
    } catch (error) {
      if (status) status.textContent = `Could not create a new ChatGPT conversation: ${error.message || error}`;
    } finally {
      newChatButton.disabled = false;
    }
  });
}

async function selectReviewProject(projectId) {
  currentProjectId = projectId;
  await refreshReview();
  await renderBatchReview();
}

function moveReviewSelection(delta) {
  if (!reviewQueueProjects.length) return;
  const found = reviewQueueProjects.findIndex((p) => p.id === currentProjectId);
  const index = found < 0 ? 0 : found;
  const next = (index + delta + reviewQueueProjects.length) % reviewQueueProjects.length;
  selectReviewProject(reviewQueueProjects[next].id).catch(() => {});
}

async function approveFromGrid(projectId) {
  try {
    await window.zeroPOD.review.pass({ projectId });
    if (currentProjectId === projectId) currentProjectId = null;
    await renderBatchReview();
    if (reviewQueueProjects.length) await selectReviewProject(reviewQueueProjects[0].id);
    else await refreshReview();
  } catch (error) { alert(`Could not approve design: ${error.message || error}`); }
}

async function rejectFromGrid(projectId) {
  const project = await window.zeroPOD.projects.get(projectId);
  const notes = prompt('Regeneration notes for this design:', project.review?.notes || '');
  if (notes === null) return;
  try {
    currentProjectId = projectId;
    await window.zeroPOD.review.reject({ projectId, notes: notes.trim() });
    await renderBatchReview();
    await refreshReview();
  } catch (error) { alert(`Could not regenerate design: ${error.message || error}`); }
}

async function renderBatchReview() {
  ensureReviewGallery();
  const root = document.getElementById('batchReviewGrid');
  if (!root) return;
  const projects = await window.zeroPOD.projects.list();
  reviewQueueProjects = projects.filter((project) => project.status === 'awaiting-review' && project.generatedImagePath);
  document.getElementById('batchReviewCount').textContent = `${reviewQueueProjects.length} design${reviewQueueProjects.length === 1 ? '' : 's'} waiting for review`;
  if (!reviewQueueProjects.length) {
    root.innerHTML = '<div class="batch-review-empty">No generated designs are waiting for review.</div>';
    return;
  }
  root.innerHTML = reviewQueueProjects.map((project) => `<article class="batch-review-card ${project.id === currentProjectId ? 'selected' : ''}" data-project-id="${reviewEscape(project.id)}">
    <img src="${reviewEscape(reviewFileUrl(project.generatedImagePath))}" alt="Generated design">
    <div class="source" title="${reviewEscape(project.sourceUrl || '')}">${reviewEscape(project.sourceUrl || 'No source URL')}</div>
    <div class="notes">${reviewEscape(project.review?.notes || 'No regeneration notes')}</div>
    <div class="card-actions"><button class="grid-reject danger">Reject</button><button class="grid-pass primary">Pass</button></div>
  </article>`).join('');
  root.querySelectorAll('.batch-review-card').forEach((card) => {
    const id = card.dataset.projectId;
    card.addEventListener('click', (event) => { if (!event.target.closest('button')) selectReviewProject(id).catch(() => {}); });
    card.querySelector('.grid-pass').addEventListener('click', () => approveFromGrid(id));
    card.querySelector('.grid-reject').addEventListener('click', () => rejectFromGrid(id));
  });
}

async function enhancePublishVerification() {
  if (!document.getElementById('upload')?.classList.contains('active-view') || !currentProjectId) return;
  const project = await window.zeroPOD.projects.get(currentProjectId).catch(() => null);
  if (!project) return;
  const button = document.getElementById('publishRedbubble');
  const status = document.getElementById('uploadStatus');
  if (!button) return;

  if (project.status === 'redbubble-publish-pending') {
    button.disabled = false;
    button.textContent = 'Verify Publish';
    if (status) status.textContent = `Status: Publish Pending Verification · Attempted ${project.redbubble?.publishAttemptedAt ? new Date(project.redbubble.publishAttemptedAt).toLocaleString() : 'recently'} · Check Redbubble before verifying.`;
  } else if (project.status === 'published') {
    button.disabled = true;
    button.textContent = 'Published ✓';
    if (status && project.redbubble?.publishedUrl) status.textContent = `Status: Published · Verified URL: ${project.redbubble.publishedUrl}`;
  } else if (button.textContent === 'Verify Publish' || button.textContent === 'Published ✓') {
    button.textContent = 'Publish / Save Work';
  }
}

async function refreshActiveGenerationReview() {
  if (!document.getElementById('review')?.classList.contains('active-view') || !currentProjectId) return;
  const project = await window.zeroPOD.projects.get(currentProjectId).catch(() => null);
  if (!project) return;
  const passButton = document.getElementById('passDesign');
  const shouldRefresh = ['generating', 'regenerating', 'chatgpt-recovery-needed'].includes(project.status)
    || (project.status === 'awaiting-review' && passButton?.disabled);
  if (!shouldRefresh) return;
  await refreshReview();
  await renderBatchReview();
  if (['generating', 'regenerating'].includes(project.status)) {
    const message = document.getElementById('previewMessage');
    if (message && !message.hidden) message.textContent = 'ChatGPT is generating. ZeroPOD is waiting for the original image asset from the new response.';
  }
}

const reviewNavButton = document.querySelector('.nav[data-view="review"]');
reviewNavButton?.addEventListener('click', () => renderBatchReview().catch(() => {}));
const uploadNavButton = document.querySelector('.nav[data-view="upload"]');
uploadNavButton?.addEventListener('click', () => setTimeout(() => enhancePublishVerification().catch(() => {}), 100));

document.getElementById('passDesign')?.addEventListener('click', () => setTimeout(() => renderBatchReview().catch(() => {}), 300));
document.getElementById('rejectDesign')?.addEventListener('click', () => setTimeout(() => renderBatchReview().catch(() => {}), 300));
document.getElementById('publishRedbubble')?.addEventListener('click', () => setTimeout(() => enhancePublishVerification().catch(() => {}), 800));

ensureReviewGallery();
ensureV105Controls();
renderBatchReview().catch(() => {});
setInterval(() => enhancePublishVerification().catch(() => {}), 1500);
setInterval(() => refreshActiveGenerationReview().catch(() => {}), 1000);
