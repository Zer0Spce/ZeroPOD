(() => {
  const root = document.getElementById('taskWorkload');
  if (!root) return;

  const FIELDS = [
    ['id', 'ID'],
    ['niche', 'Niche'],
    ['idea', 'Idea (text or link)'],
    ['text', 'Text in Image (exact)'],
    ['reference', 'Reference Link'],
    ['difference', 'Difference from Original']
  ];
  const CHAT_KEY = 'zeropod.taskWorkload.newChat.v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  let rows = [];
  let running = false;
  let paused = false;
  let dirty = false;
  let busy = false;
  let snapshotSignature = '';

  const style = document.createElement('style');
  style.id = 'taskWorkloadWideStyles';
  style.textContent = [
    '#taskWorkload.view{max-width:none!important;width:100%;min-width:0}',
    '.content:has(#taskWorkload.active-view){padding:30px 22px 35px 30px}',
    '#taskWorkload .tw-panel{background:var(--surface,#15191f);border:1px solid var(--border,#29313c);border-radius:15px;padding:18px;margin:20px 0;width:100%;min-width:0}',
    '#taskWorkload .tw-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:15px}',
    '#taskWorkload .tw-top h2{margin-bottom:4px}',
    '#taskWorkload .tw-stats{display:flex;gap:7px;flex-wrap:wrap}',
    '#taskWorkload .tw-stats span{background:var(--surface-2,#1b2027);border:1px solid var(--border,#29313c);padding:8px 11px;border-radius:9px;font-size:12px;color:var(--muted,#9ca6b6)}',
    '#taskWorkload .tw-stats strong{color:var(--text,#fff)}',
    '#taskWorkload .tw-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-bottom:13px}',
    '#taskWorkload .tw-toolbar button{white-space:nowrap}',
    '#taskWorkload .tw-table-wrap{overflow-x:auto;overflow-y:visible;width:100%;max-width:100%;border:1px solid var(--border,#29313c);border-radius:11px;background:var(--bg-elevated,#101318)}',
    '#taskWorkload .tw-table{border-collapse:collapse;table-layout:fixed;min-width:1280px;width:100%}',
    '#taskWorkload .tw-table th{background:var(--surface-2,#1b2027);color:var(--muted,#9ca6b6);font-weight:750;font-size:11px;text-align:left;vertical-align:middle;padding:12px 8px;white-space:normal;border-bottom:1px solid var(--border,#29313c)}',
    '#taskWorkload .tw-table td{padding:10px 6px;vertical-align:middle;border-bottom:1px solid var(--border-soft,#222933)}',
    '#taskWorkload .tw-table tr:last-child td{border-bottom:0}',
    '#taskWorkload .tw-table tbody tr:hover{background:var(--surface-2,#1b2027)}',
    '#taskWorkload .tw-table input{min-width:0;width:100%;box-sizing:border-box;padding:11px 10px;font-size:13px;height:43px;text-overflow:ellipsis;white-space:nowrap}',
    '#taskWorkload .tw-index{color:var(--muted,#9ca6b6);font-weight:750;text-align:center;font-size:12px}',
    '#taskWorkload .tw-status-badge{display:inline-flex;align-items:center;justify-content:center;max-width:100%;padding:6px 9px;border-radius:8px;background:var(--surface-3,#202631);color:var(--muted,#9ca6b6);font-size:11px;font-weight:750;text-transform:capitalize;overflow:hidden;text-overflow:ellipsis}',
    '#taskWorkload .tw-status-badge.completed{background:#173025;color:#85ddb0}',
    '#taskWorkload .tw-status-badge.working{background:#1e2d46;color:#9ac4ff}',
    '#taskWorkload .tw-status-badge.failed{background:#3b2326;color:#ffb4bc}',
    '#taskWorkload .tw-status-badge.pending{background:#252945;color:#b6c2ff}',
    '#taskWorkload .tw-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:16px}',
    '#taskWorkload .tw-actions button{white-space:nowrap}',
    '#taskWorkload .tw-new-chat{margin-top:15px;padding:13px 15px;border:1px solid var(--border,#29313c);border-radius:11px;background:var(--surface-2,#1b2027)}',
    '#taskWorkload .tw-new-chat label{display:flex;align-items:flex-start;gap:11px;cursor:pointer;font-weight:600}',
    '#taskWorkload .tw-new-chat input{width:19px;height:19px;flex:0 0 19px;margin:1px 0 0;accent-color:var(--accent,#3b82f6)}',
    '#taskWorkload .tw-new-chat strong{font-size:14px}',
    '#taskWorkload .tw-new-chat span{display:block;font-size:12px;line-height:1.5;color:var(--muted,#9ca6b6);font-weight:400;margin-top:3px}',
    '#taskWorkload .tw-hint{font-size:12px;color:var(--muted,#9ca6b6);line-height:1.55;margin:13px 0 0}',
    '#taskWorkload .tw-note{font-size:12px;color:#85ddb0;line-height:1.5;white-space:normal;margin:8px 0 0}',
    '#taskWorkload .tw-output-list{display:grid;gap:7px;margin-top:12px}',
    '#taskWorkload .tw-output-item{display:grid;grid-template-columns:minmax(0,190px) minmax(0,1fr);gap:12px;padding:10px 12px;border-radius:8px;background:var(--surface-2,#1b2027);font-size:12px}',
    '#taskWorkload .tw-output-item strong{color:var(--text,#fff);overflow:hidden;text-overflow:ellipsis}',
    '#taskWorkload .tw-output-item span{color:#85ddb0;overflow-wrap:anywhere}',
    '#taskWorkload .tw-output-item.failed span{color:#ffb4bc}',
    '@media(max-width:1050px){.content:has(#taskWorkload.active-view){padding:22px 14px}.tw-output-item{grid-template-columns:1fr!important}}'
  ].join('');
  document.head.appendChild(style);

  root.innerHTML =
    '<div class="tw-top">' +
      '<div><div class="eyebrow">LOCAL PNG PRODUCTION</div><h2>Task Workload</h2>' +
      '<p class="muted">One line per job · Generate → Vectorize → 4500 × 5400 transparent PNG · No approval gates or publishing.</p></div>' +
      '<div class="tw-stats" id="twStats"></div>' +
    '</div>' +
    '<div class="tw-panel">' +
      '<div class="tw-toolbar">' +
        '<button id="twAdd">+ Add Row</button>' +
        '<button id="twImport">Add List (.xlsx)</button>' +
        '<button id="twSave">Save Queue</button>' +
        '<button id="twOpenOutput">Open Output Folder</button>' +
      '</div>' +
      '<div class="tw-table-wrap">' +
        '<table class="tw-table"><colgroup>' +
          '<col style="width:38px"><col style="width:130px"><col style="width:168px">' +
          '<col style="width:240px"><col style="width:190px"><col style="width:209px">' +
          '<col style="width:185px"><col style="width:120px">' +
        '</colgroup><thead><tr><th>#</th>' +
          FIELDS.map(field => '<th>' + esc(field[1]) + '</th>').join('') +
          '<th>Status</th></tr></thead><tbody id="twRows"></tbody></table>' +
      '</div>' +
      '<div class="tw-new-chat"><label>' +
        '<input type="checkbox" id="twNewChat">' +
        '<div><strong>New Chat</strong><span>Start each new Task Workload run in one fresh ChatGPT conversation. All rows in that run reuse the same chat; pausing and resuming does not create another.</span></div>' +
      '</label></div>' +
      '<div class="tw-actions">' +
        '<button class="primary" id="twStart">Start Automation</button>' +
        '<button id="twPause">Pause</button>' +
        '<button class="danger" id="twStop">Stop</button>' +
        '<button id="twClearCompleted">Clear Completed</button>' +
        '<button id="twClearFailed">Clear Failed Jobs</button>' +
      '</div>' +
      '<p id="twSummary" class="tw-hint"></p>' +
      '<p id="twImportNote" class="tw-note" aria-live="polite"></p>' +
    '</div>' +
    '<div class="tw-panel"><h3>Finished PNGs and job details</h3>' +
      '<p class="tw-hint">Files are saved locally using ID_Niche.png. Select Open Output Folder above to see them.</p>' +
      '<div class="tw-output-list" id="twOutputs"></div>' +
    '</div>';

  const body = document.getElementById('twRows');
  const newChatCheckbox = document.getElementById('twNewChat');
  newChatCheckbox.checked = localStorage.getItem(CHAT_KEY) === 'true';
  newChatCheckbox.addEventListener('change', () => {
    localStorage.setItem(CHAT_KEY, String(newChatCheckbox.checked));
  });

  function render() {
    const stats = { completed: 0, working: 0, failed: 0 };
    for (const row of rows) if (Object.prototype.hasOwnProperty.call(stats, row.status)) stats[row.status] += 1;
    document.getElementById('twStats').innerHTML =
      '<span>Total <strong>' + rows.length + '</strong> / 50</span>' +
      '<span>Completed <strong>' + stats.completed + '</strong></span>' +
      '<span>Working <strong>' + stats.working + '</strong></span>' +
      '<span>Failed <strong>' + stats.failed + '</strong></span>';

    body.innerHTML = rows.map((row, i) =>
      '<tr><td class="tw-index">' + (i + 1) + '</td>' +
      FIELDS.map(field => {
        const key = field[0];
        const value = esc(row[key] || '');
        return '<td><input data-i="' + i + '" data-k="' + key +
          '" value="' + value + '" title="' + value + '"' +
          (running ? ' disabled' : '') + '></td>';
      }).join('') +
      '<td title="' + esc(row.error || row.output || '') + '">' +
        '<span class="tw-status-badge ' + esc(row.status || 'pending') + '">' + esc(row.status || 'pending') + '</span>' +
      '</td></tr>'
    ).join('');

    const recent = rows.filter(row => row.output || row.error);
    document.getElementById('twOutputs').innerHTML = recent.length ?
      recent.map(row =>
        '<div class="tw-output-item' + (row.error ? ' failed' : '') + '">' +
          '<strong>' + esc(row.id + ' · ' + row.niche) + '</strong>' +
          '<span>' + esc(row.error || row.output) + '</span>' +
        '</div>'
      ).join('') : '<p class="tw-hint">No exported files or job errors yet.</p>';

    document.getElementById('twSummary').textContent =
      rows.length + ' / 50 jobs · ' + (running ? (paused ? 'Paused' : 'Running') : 'Stopped') +
      (dirty ? ' · Unsaved edits' : '');

    document.getElementById('twAdd').disabled = running || busy || rows.length >= 50;
    document.getElementById('twImport').disabled = running || busy;
    document.getElementById('twSave').disabled = running || busy;
    document.getElementById('twStart').disabled = busy || (running && !paused);
    document.getElementById('twPause').disabled = busy || !running;
    document.getElementById('twPause').textContent = paused ? 'Resume' : 'Pause';
    document.getElementById('twStop').disabled = busy || !running;
    document.getElementById('twClearCompleted').disabled = busy || running;
    document.getElementById('twClearFailed').disabled = busy || running;
    newChatCheckbox.disabled = running || busy;
  }

  body.addEventListener('input', event => {
    const control = event.target;
    if (!control.dataset.k || running) return;
    const index = Number(control.dataset.i);
    if (!rows[index]) return;
    rows[index][control.dataset.k] = control.value;
    dirty = true;
    document.getElementById('twSummary').textContent = rows.length + ' / 50 jobs · Unsaved edits';
  });

  async function refresh(force) {
    if (dirty && !force) return;
    const data = await window.zeroPOD.taskWorkload.list();
    const signature = JSON.stringify([data.rows, data.running, data.paused]);
    if (signature === snapshotSignature && !force) return;
    snapshotSignature = signature;
    rows = data.rows;
    running = Boolean(data.running);
    paused = Boolean(data.paused);
    render();
  }

  async function save() {
    if (running) throw new Error('Stop Task Workload before changing the queue.');
    const data = await window.zeroPOD.taskWorkload.set(rows);
    dirty = false;
    rows = data.rows;
    snapshotSignature = '';
    render();
  }

  async function act(action) {
    if (busy) return;
    busy = true;
    render();
    try {
      await action();
      await refresh(true);
    } catch (error) {
      alert(error.message || String(error));
    } finally {
      busy = false;
      render();
    }
  }

  document.getElementById('twAdd').addEventListener('click', () => {
    if (running || busy) return;
    if (rows.length >= 50) return alert('Task Workload supports up to 50 jobs.');
    rows.push(Object.fromEntries(FIELDS.map(field => [field[0], ''])));
    dirty = true;
    render();
  });
  document.getElementById('twSave').addEventListener('click', () => act(save));
  document.getElementById('twImport').addEventListener('click', () => act(async () => {
    if (dirty) await save();
    const result = await window.zeroPOD.taskWorkload.importXlsx();
    if (result.canceled) return;
    dirty = false;
    rows = result.snapshot.rows;
    document.getElementById('twImportNote').textContent =
      'Added ' + result.added + ' job(s) from ' + result.file +
      (result.skipped ? ' · Skipped ' + result.skipped + ' already-listed ID(s)' : '') + '.';
  }));
  document.getElementById('twOpenOutput').addEventListener('click', () =>
    act(() => window.zeroPOD.taskWorkload.openOutputFolder()));
  document.getElementById('twStart').addEventListener('click', () => act(async () => {
    if (dirty) await save();
    const state = await window.zeroPOD.taskWorkload.list();
    if (!state.rows.some(row => row.status !== 'completed')) {
      throw new Error('Add a new job before starting Task Workload.');
    }
    // Match the existing Automation New Chat behavior: once per new run, never on resume.
    if (!state.running && newChatCheckbox.checked) {
      document.getElementById('twImportNote').textContent = 'Opening one fresh ChatGPT conversation for this run…';
      await window.zeroPOD.generation.newChat();
      document.getElementById('twImportNote').textContent =
        'New Chat ready. Every job in this run will reuse the same conversation.';
    }
    await window.zeroPOD.taskWorkload.start();
  }));
  document.getElementById('twPause').addEventListener('click', () => act(() =>
    paused ? window.zeroPOD.taskWorkload.start() : window.zeroPOD.taskWorkload.pause()));
  document.getElementById('twStop').addEventListener('click', () =>
    act(() => window.zeroPOD.taskWorkload.stop()));
  document.getElementById('twClearCompleted').addEventListener('click', () =>
    act(() => window.zeroPOD.taskWorkload.clear('completed')));
  document.getElementById('twClearFailed').addEventListener('click', () =>
    act(() => window.zeroPOD.taskWorkload.clear('failed')));

  refresh(true).catch(error => console.error('[Task Workload]', error));
  setInterval(() => {
    if (root.classList.contains('active-view')) refresh(false).catch(() => {});
  }, 1500);
})();