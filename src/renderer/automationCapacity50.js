(() => {
  if (window.__zeroPODAutomationCapacity50Installed) return;
  window.__zeroPODAutomationCapacity50Installed = true;

  const MAX_ROWS = 50;
  const esc = (value) => window.automationEscape(value);

  function updateCopy() {
    const heading = document.querySelector('#automation .az-head p.muted');
    if (heading) heading.textContent = heading.textContent.replace(/Queue up to \d+/, `Queue up to ${MAX_ROWS}`);

    const jobHint = document.querySelector('#automation .az-panel .heading-row .last-seen');
    if (jobHint) jobHint.textContent = jobHint.textContent.replace(/up to \d+/, `up to ${MAX_ROWS}`);

    document.querySelectorAll('#flyingResearch .fr-small').forEach((node) => {
      node.textContent = node.textContent.replace(/(?:15|30)-row limit/gi, `${MAX_ROWS}-row limit`);
    });
  }

  async function refresh50() {
    const root = document.getElementById('automationRowsV2');
    if (!root || !window.zeroPOD?.automation) return;
    const snapshot = await window.zeroPOD.automation.list();

    window.captureAutomationChanges(snapshot);
    const state = document.getElementById('automationStateV2');
    if (state) state.textContent = snapshot.state === 'running' ? 'Working' : snapshot.state.charAt(0).toUpperCase() + snapshot.state.slice(1);

    const rows = snapshot.rows.slice(0, MAX_ROWS);
    const counter = document.getElementById('automationRowCounter');
    if (counter) counter.textContent = `${rows.length} / ${MAX_ROWS}`;

    const addButton = document.getElementById('automationAddRowV2');
    if (addButton) addButton.disabled = rows.length >= MAX_ROWS || snapshot.state === 'running';

    root.innerHTML = rows.map((row, index) => {
      const visual = window.rowVisualStatus(row, snapshot.state);
      const locked = row.status === 'running' || row.status === 'completed';
      return `<div class="az-row" data-row-id="${esc(row.id)}">
        <div class="az-index">${index + 1}</div>
        <div class="az-file"><button class="az-browse" ${locked ? 'disabled' : ''}>Browse Image</button><input class="az-image" value="${esc(row.referenceImage || '')}" readonly placeholder="Choose image…"></div>
        <input class="az-url" type="url" value="${esc(row.amazonLink || '')}" ${locked ? 'disabled' : ''} placeholder="Amazon / source URL">
        <span class="az-status ${visual.cls}">${visual.label}</span>
        <button class="az-remove danger" ${locked ? 'disabled' : ''} title="Remove row">−</button>
        <div class="az-row-step">${esc(row.step || 'Waiting')}</div>
        ${row.lastError ? `<div class="az-row-error">${esc(row.lastError)}</div>` : ''}
      </div>`;
    }).join('');

    root.querySelectorAll('.az-row').forEach((rowEl) => {
      const rowId = rowEl.dataset.rowId;
      const row = rows.find((item) => item.id === rowId);
      rowEl.querySelector('.az-browse')?.addEventListener('click', async () => {
        const file = await window.zeroPOD.files.chooseReference();
        if (!file) return;
        await window.zeroPOD.automation.update({ rowId, patch: { referenceImage: file } });
        await refresh50();
      });
      rowEl.querySelector('.az-url')?.addEventListener('change', async (event) => {
        await window.zeroPOD.automation.update({ rowId, patch: { amazonLink: event.target.value.trim() } });
        await refresh50();
      });
      rowEl.querySelector('.az-remove')?.addEventListener('click', async () => {
        await window.zeroPOD.automation.remove(rowId);
        await refresh50();
      });
      if (row?.status === 'needs-attention') {
        const status = rowEl.querySelector('.az-status');
        if (status) status.title = row.lastError || 'Failed';
      }
    });

    const counts = snapshot.counts || {};
    const summary = document.getElementById('automationSummaryV2');
    if (summary) {
      summary.innerHTML = [
        `Total ${rows.length}`,
        `Published ${counts.completed || 0}`,
        `Working ${counts.running || 0}`,
        `Failed ${counts['needs-attention'] || 0}`
      ].map((text) => `<span>${esc(text)}</span>`).join('');
    }

    const resultRows = await window.enrichCompletedRows(rows.filter((row) => row.status === 'completed'));
    const results = document.getElementById('automationResultsV2');
    if (results) {
      if (!resultRows.length) {
        results.innerHTML = '<div class="az-result-empty">Published previews will appear here.</div>';
      } else {
        results.innerHTML = resultRows.map((row, index) => `<article class="az-result">
          ${row.previewPath ? `<img src="${esc(window.automationFileUrl(row.previewPath))}" alt="Published preview">` : '<div class="az-result-empty">Preview unavailable</div>'}
          <div class="az-result-body"><div class="az-result-title">✓ ${esc(row.listingTitle || `Published job ${index + 1}`)}</div>${row.publishedUrl ? `<a href="${esc(row.publishedUrl)}" target="_blank" rel="noreferrer">Open published work ↗</a>` : '<span class="last-seen">Publish verified</span>'}</div>
        </article>`).join('');
      }
    }

    updateCopy();
  }

  async function addRow50() {
    const snapshot = await window.zeroPOD.automation.list();
    if (snapshot.rows.length >= MAX_ROWS) return;
    await window.zeroPOD.automation.add([{ referenceImage: '', amazonLink: '', notes: '' }]);
    window.automationLog(`Added row ${snapshot.rows.length + 1}.`);
    await refresh50();
  }

  // Replace the global refresh function used by polling/navigation so all 50 rows
  // remain visible instead of the original renderer slicing the queue to 30.
  window.refreshAutomationListV2 = refresh50;
  window.addAutomationRowV2 = addRow50;

  // The original + button captured the old addAutomationRowV2 function directly.
  // Clone it once to remove that old listener and bind the 50-row implementation.
  const oldAdd = document.getElementById('automationAddRowV2');
  if (oldAdd?.parentNode) {
    const replacement = oldAdd.cloneNode(true);
    oldAdd.parentNode.replaceChild(replacement, oldAdd);
    replacement.addEventListener('click', addRow50);
  }

  updateCopy();
  refresh50().catch((error) => window.automationLog?.(`Refresh error: ${error.message || error}`, 'error'));

  let attempts = 0;
  const copyTimer = setInterval(() => {
    attempts += 1;
    updateCopy();
    if (attempts >= 20 || document.querySelector('#flyingResearch .fr-small')) clearInterval(copyTimer);
  }, 250);
})();
