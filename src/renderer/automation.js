let automationPoll = null;
let automationEnsuringFirstRow = false;
const automationSeenStates = new Map();
const automationLogLines = [];
const AUTOMATION_MAX_ROWS = 15;

function automationEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function automationFileUrl(filePath) {
  return `file:///${String(filePath || '').replace(/\\/g, '/')}`;
}

function automationTime() {
  return new Date().toLocaleTimeString();
}

function automationLog(message, kind = '') {
  automationLogLines.push({ time: automationTime(), message: String(message || ''), kind });
  while (automationLogLines.length > 300) automationLogLines.shift();
  const root = document.getElementById('automationLiveLog');
  if (!root) return;
  root.innerHTML = automationLogLines.map((line) => `<div class="az-log-line az-${automationEscape(line.kind)}"><span>${automationEscape(line.time)}</span><b>${automationEscape(line.message)}</b></div>`).join('');
  root.scrollTop = root.scrollHeight;
}

function installAutomationListStyles() {
  if (document.getElementById('automationListV2Styles')) return;
  const style = document.createElement('style');
  style.id = 'automationListV2Styles';
  style.textContent = `
    .az-shell{max-width:1280px}.az-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}.az-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.az-beta{padding:5px 9px;border-radius:999px;border:1px solid #62522b;background:#241f12;color:#e9d27a;font-size:11px;font-weight:800}.az-state{padding:7px 10px;border-radius:9px;background:#11161c;border:1px solid #313946;color:#abb5c3;text-transform:capitalize}.az-panel{background:#171b21;border:1px solid #2a313c;border-radius:14px;padding:16px;margin:15px 0}.az-warning{font-size:12px;line-height:1.5;color:#d8c474;background:#211d11;border:1px solid #574a26;border-radius:10px;padding:11px 13px;margin-top:12px}.az-rows{display:grid;gap:10px}.az-row{display:grid;grid-template-columns:42px minmax(300px,1fr) minmax(300px,1fr) 150px 42px;gap:10px;align-items:center;padding:11px;background:#101419;border:1px solid #2a313c;border-radius:11px}.az-index{width:32px;height:32px;display:grid;place-items:center;border-radius:9px;background:#1b222b;color:#aeb8c7;font-weight:800}.az-file{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px}.az-file button{white-space:nowrap}.az-file input,.az-url{width:100%;min-width:0}.az-status{font-size:12px;font-weight:800;padding:7px 9px;border-radius:999px;text-align:center;border:1px solid #38414e;background:#171d24;color:#aeb8c7;white-space:nowrap}.az-status.working{border-color:#66592a;color:#eedb80;background:#252014}.az-status.published{border-color:#315f48;color:#91e2b5;background:#13231a}.az-status.failed{border-color:#673740;color:#ffabb4;background:#28151a}.az-status.ready{border-color:#40506b;color:#b9c7e4;background:#151c27}.az-remove{width:36px;height:36px;padding:0}.az-row-error{grid-column:2/-1;color:#ff9ba5;font-size:11px;line-height:1.4}.az-row-step{grid-column:2/-1;color:#8995a5;font-size:11px;margin-top:-5px}.az-add-wrap{display:flex;justify-content:flex-end;margin-top:10px}.az-add{width:42px;height:38px;font-size:20px;padding:0}.az-controls{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.az-summary{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.az-summary span{padding:6px 9px;border-radius:8px;background:#101419;border:1px solid #2a313c;color:#9da8b6;font-size:12px}.az-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,.8fr);gap:15px;align-items:start}.az-log{height:290px;overflow:auto;background:#090c0f;border:1px solid #2a313c;border-radius:10px;padding:10px;font-family:Consolas,monospace;font-size:11px}.az-log-line{display:grid;grid-template-columns:80px 1fr;gap:8px;line-height:1.55}.az-log-line span{color:#667386}.az-log-line b{font-weight:400;color:#c5cbd4}.az-log-line.az-ok b{color:#85ddb0}.az-log-line.az-error b{color:#ff9ba5}.az-log-line.az-warn b{color:#e9d27a}.az-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}.az-result{background:#101419;border:1px solid #2a313c;border-radius:12px;overflow:hidden}.az-result img{width:100%;height:220px;object-fit:contain;background:#090c0f}.az-result-body{padding:11px}.az-result-title{font-size:12px;font-weight:800;line-height:1.35;margin-bottom:8px}.az-result a{font-size:12px;color:#8fa1ff;text-decoration:none;word-break:break-word}.az-result a:hover{text-decoration:underline}.az-result-empty{padding:26px;text-align:center;color:#818c9a;border:1px dashed #343d49;border-radius:10px}.az-row input:disabled,.az-row button:disabled{opacity:.55;cursor:not-allowed}
    @media(max-width:1150px){.az-grid{grid-template-columns:1fr}.az-row{grid-template-columns:38px 1fr 1fr 125px 38px}}
    @media(max-width:820px){.az-row{grid-template-columns:38px 1fr 38px}.az-file,.az-url{grid-column:2}.az-status{grid-column:2}.az-remove{grid-column:3;grid-row:1}.az-row-error,.az-row-step{grid-column:2/-1}}
  `;
  document.head.appendChild(style);
}

function buildAutomationListV2() {
  installAutomationListStyles();
  const section = document.getElementById('automation');
  if (!section) return;
  section.innerHTML = `
    <div class="az-shell">
      <div class="eyebrow">FULL AUTO BATCH · BETA</div>
      <div class="az-head">
        <div><h2>Automation List</h2><p class="muted">Queue up to 15 image + source URL jobs. ZeroPOD runs the proven workflow from generation through verified Redbubble publish, one row at a time.</p></div>
        <div class="az-head-actions"><span class="az-beta">AUTOMATE EVERYTHING · BETA</span><span id="automationStateV2" class="az-state">Stopped</span></div>
      </div>
      <div class="az-warning">Beta full automation skips both manual approval checks and publishes automatically. ZeroPOD cannot guarantee Redbubble placement, listing accuracy, or the final product result. Published product previews are shown below so you can review what went live.</div>

      <div class="az-panel">
        <div class="heading-row"><div><h3>Jobs</h3><div class="last-seen">Runs strictly from row 1 → row 15. Add only the rows you need.</div></div><span id="automationRowCounter" class="last-seen">0 / 15</span></div>
        <div id="automationRowsV2" class="az-rows"></div>
        <div class="az-add-wrap"><button id="automationAddRowV2" class="az-add" title="Add another job">+</button></div>
        <div id="automationSummaryV2" class="az-summary"></div>
        <div class="az-controls"><button id="automationStartV2" class="primary">Start Automation</button><button id="automationPauseV2">Pause</button><button id="automationStopV2" class="danger">Stop</button><button id="automationClearPublishedV2" class="secondary">Clear Published</button></div>
      </div>

      <div class="az-grid">
        <div class="az-panel"><div class="heading-row"><div><h3>Published Results</h3><div class="last-seen">Final Redbubble product preview + verified publish link.</div></div></div><div id="automationResultsV2" class="az-results"></div></div>
        <div class="az-panel"><div class="heading-row"><div><h3>Live Automation Log</h3><div class="last-seen">Every row status/step change appears here.</div></div><button id="automationClearLogV2" class="secondary">Clear</button></div><div id="automationLiveLog" class="az-log"></div></div>
      </div>
    </div>`;

  document.getElementById('automationAddRowV2').addEventListener('click', addAutomationRowV2);
  document.getElementById('automationStartV2').addEventListener('click', startAutomationV2);
  document.getElementById('automationPauseV2').addEventListener('click', async () => { await window.zeroPOD.automation.pause(); automationLog('Queue paused.', 'warn'); await refreshAutomationListV2(); });
  document.getElementById('automationStopV2').addEventListener('click', async () => { await window.zeroPOD.automation.stop(); automationLog('Queue stopped.', 'warn'); await refreshAutomationListV2(); });
  document.getElementById('automationClearPublishedV2').addEventListener('click', async () => { await window.zeroPOD.automation.clearCompleted(); automationLog('Published rows cleared.'); await ensureFirstAutomationRow(); await refreshAutomationListV2(); });
  document.getElementById('automationClearLogV2').addEventListener('click', () => { automationLogLines.length = 0; document.getElementById('automationLiveLog').innerHTML = ''; });
}

function rowVisualStatus(row, queueState) {
  if (row.status === 'completed') return { label: 'Published ✓', cls: 'published' };
  if (row.status === 'needs-attention') return { label: 'Failed', cls: 'failed' };
  if (row.status === 'draft') return { label: 'Needs input', cls: 'ready' };
  if (row.status === 'running') return { label: 'Working', cls: 'working' };
  if (queueState === 'running' && ['pending', 'ready'].includes(row.status)) return { label: 'Queued', cls: 'working' };
  return { label: 'Ready', cls: 'ready' };
}

async function enrichCompletedRows(rows) {
  const enriched = [];
  for (const row of rows) {
    if (row.status !== 'completed' || (!row.projectId) || (row.previewPath && row.publishedUrl)) {
      enriched.push(row);
      continue;
    }
    try {
      const project = await window.zeroPOD.projects.get(row.projectId);
      enriched.push({
        ...row,
        previewPath: row.previewPath || project.redbubble?.reviewScreenshotPath || null,
        publishedUrl: row.publishedUrl || project.redbubble?.publishedUrl || null,
        listingTitle: row.listingTitle || project.redbubble?.title || project.metadata?.title || null
      });
    } catch { enriched.push(row); }
  }
  return enriched;
}

function captureAutomationChanges(snapshot) {
  snapshot.rows.forEach((row, index) => {
    const signature = `${row.status}|${row.step || ''}|${row.lastError || ''}`;
    if (automationSeenStates.get(row.id) === signature) return;
    automationSeenStates.set(row.id, signature);
    const n = index + 1;
    if (row.status === 'completed') automationLog(`Row ${n}: Published ✓`, 'ok');
    else if (row.status === 'needs-attention') automationLog(`Row ${n}: Failed · ${row.lastError || row.step || 'Needs attention'}`, 'error');
    else if (row.status === 'running') automationLog(`Row ${n}: ${row.step || 'Working'}`);
    else if (snapshot.state === 'running' && row.status === 'ready') automationLog(`Row ${n}: ${row.step || 'Ready for next step'}`);
  });
}

async function ensureFirstAutomationRow() {
  if (automationEnsuringFirstRow) return;
  automationEnsuringFirstRow = true;
  try {
    const snapshot = await window.zeroPOD.automation.list();
    if (!snapshot.rows.length) await window.zeroPOD.automation.add([{ referenceImage: '', amazonLink: '', notes: '' }]);
  } finally { automationEnsuringFirstRow = false; }
}

async function refreshAutomationListV2() {
  const root = document.getElementById('automationRowsV2');
  if (!root || !window.zeroPOD?.automation) return;
  let snapshot = await window.zeroPOD.automation.list();
  if (!snapshot.rows.length && !automationEnsuringFirstRow) {
    await ensureFirstAutomationRow();
    snapshot = await window.zeroPOD.automation.list();
  }

  captureAutomationChanges(snapshot);
  const state = document.getElementById('automationStateV2');
  state.textContent = snapshot.state === 'running' ? 'Working' : snapshot.state.charAt(0).toUpperCase() + snapshot.state.slice(1);
  const rows = snapshot.rows.slice(0, AUTOMATION_MAX_ROWS);
  document.getElementById('automationRowCounter').textContent = `${rows.length} / ${AUTOMATION_MAX_ROWS}`;
  const addButton = document.getElementById('automationAddRowV2');
  addButton.disabled = rows.length >= AUTOMATION_MAX_ROWS || snapshot.state === 'running';

  root.innerHTML = rows.map((row, index) => {
    const visual = rowVisualStatus(row, snapshot.state);
    const locked = row.status === 'running' || row.status === 'completed';
    return `<div class="az-row" data-row-id="${automationEscape(row.id)}">
      <div class="az-index">${index + 1}</div>
      <div class="az-file"><button class="az-browse" ${locked ? 'disabled' : ''}>Browse Image</button><input class="az-image" value="${automationEscape(row.referenceImage || '')}" readonly placeholder="Choose image…"></div>
      <input class="az-url" type="url" value="${automationEscape(row.amazonLink || '')}" ${locked ? 'disabled' : ''} placeholder="Amazon / source URL">
      <span class="az-status ${visual.cls}">${visual.label}</span>
      <button class="az-remove danger" ${locked || rows.length <= 1 ? 'disabled' : ''} title="Remove row">−</button>
      <div class="az-row-step">${automationEscape(row.step || 'Waiting')}</div>
      ${row.lastError ? `<div class="az-row-error">${automationEscape(row.lastError)}</div>` : ''}
    </div>`;
  }).join('');

  root.querySelectorAll('.az-row').forEach((rowEl) => {
    const rowId = rowEl.dataset.rowId;
    const row = rows.find((item) => item.id === rowId);
    rowEl.querySelector('.az-browse').addEventListener('click', async () => {
      const file = await window.zeroPOD.files.chooseReference();
      if (!file) return;
      await window.zeroPOD.automation.update({ rowId, patch: { referenceImage: file } });
      await refreshAutomationListV2();
    });
    rowEl.querySelector('.az-url').addEventListener('change', async (event) => {
      await window.zeroPOD.automation.update({ rowId, patch: { amazonLink: event.target.value.trim() } });
      await refreshAutomationListV2();
    });
    rowEl.querySelector('.az-remove').addEventListener('click', async () => {
      await window.zeroPOD.automation.remove(rowId);
      automationSeenStates.delete(rowId);
      await ensureFirstAutomationRow();
      await refreshAutomationListV2();
    });
    if (row?.status === 'needs-attention') {
      rowEl.querySelector('.az-status').title = row.lastError || 'Failed';
    }
  });

  const counts = snapshot.counts || {};
  document.getElementById('automationSummaryV2').innerHTML = [
    `Total ${rows.length}`,
    `Published ${counts.completed || 0}`,
    `Working ${counts.running || 0}`,
    `Failed ${counts['needs-attention'] || 0}`
  ].map((text) => `<span>${automationEscape(text)}</span>`).join('');

  const resultRows = await enrichCompletedRows(rows.filter((row) => row.status === 'completed'));
  const results = document.getElementById('automationResultsV2');
  if (!resultRows.length) {
    results.innerHTML = '<div class="az-result-empty">Published previews will appear here.</div>';
  } else {
    results.innerHTML = resultRows.map((row, index) => `<article class="az-result">
      ${row.previewPath ? `<img src="${automationEscape(automationFileUrl(row.previewPath))}" alt="Published preview">` : '<div class="az-result-empty">Preview unavailable</div>'}
      <div class="az-result-body"><div class="az-result-title">✓ ${automationEscape(row.listingTitle || `Published job ${index + 1}`)}</div>${row.publishedUrl ? `<a href="${automationEscape(row.publishedUrl)}" target="_blank" rel="noreferrer">Open published work ↗</a>` : '<span class="last-seen">Publish verified</span>'}</div>
    </article>`).join('');
  }
}

async function addAutomationRowV2() {
  const snapshot = await window.zeroPOD.automation.list();
  if (snapshot.rows.length >= AUTOMATION_MAX_ROWS) return;
  await window.zeroPOD.automation.add([{ referenceImage: '', amazonLink: '', notes: '' }]);
  automationLog(`Added row ${snapshot.rows.length + 1}.`);
  await refreshAutomationListV2();
}

async function startAutomationV2() {
  try {
    const snapshot = await window.zeroPOD.automation.list();
    if (!snapshot.rows.length) return;
    const incomplete = snapshot.rows.findIndex((row) => !String(row.referenceImage || '').trim() || !String(row.amazonLink || '').trim());
    if (incomplete >= 0) {
      automationLog(`Row ${incomplete + 1} needs both an image and source URL before starting.`, 'error');
      return;
    }
    automationLog(`Starting full automation for ${snapshot.rows.length} job${snapshot.rows.length === 1 ? '' : 's'} · 1 → ${snapshot.rows.length}.`, 'warn');
    await window.zeroPOD.automation.start();
    await refreshAutomationListV2();
  } catch (error) {
    automationLog(`Could not start queue: ${error.message || error}`, 'error');
  }
}

function startAutomationPollingV2() {
  if (automationPoll) return;
  automationPoll = setInterval(() => {
    const visible = document.getElementById('automation')?.classList.contains('active-view');
    if (visible) refreshAutomationListV2().catch((error) => automationLog(`Refresh error: ${error.message || error}`, 'error'));
  }, 1200);
}

buildAutomationListV2();
ensureFirstAutomationRow().then(refreshAutomationListV2).catch((error) => automationLog(error.message || error, 'error'));
const automationNavV2 = document.querySelector('.nav[data-view="automation"]');
if (automationNavV2) automationNavV2.addEventListener('click', () => refreshAutomationListV2().catch(() => {}));
startAutomationPollingV2();
