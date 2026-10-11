(() => {
  const api = window.zeroPOD?.automateList;
  if (!api) return;

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  let timer = null;
  let lastSnapshot = null;

  function stateLabel(state) {
    return ({
      stopped: 'Stopped',
      running: 'Working',
      paused: 'Paused',
      'waiting-space': 'Waiting for Automation space',
      completed: 'Completed'
    })[state] || state || 'Stopped';
  }

  function statusLabel(status) {
    return ({
      pending: 'Pending',
      checking: 'Checking Amazon',
      'waiting-space': 'Waiting for space',
      added: 'Sent to Automation',
      skipped: 'Skipped',
      'needs-attention': 'Needs attention'
    })[status] || status || 'Pending';
  }

  function render(snapshot) {
    lastSnapshot = snapshot;
    const counts = snapshot.counts || {};
    const root = document.getElementById('automateListRows');
    const state = document.getElementById('automateListState');
    const source = document.getElementById('automateListSource');
    const message = document.getElementById('automateListMessage');
    const automationSpace = document.getElementById('automateListAutomationSpace');
    const summary = document.getElementById('automateListSummary');

    if (state) {
      state.textContent = stateLabel(snapshot.state);
      state.classList.toggle('working', ['running', 'waiting-space'].includes(snapshot.state));
    }
    if (source) source.textContent = snapshot.sourceFile || 'No list file loaded yet.';
    if (message) message.textContent = snapshot.lastMessage || 'Upload a list containing Amazon product links.';
    if (automationSpace) automationSpace.textContent = `${snapshot.automation?.used || 0} / ${snapshot.automation?.limit || 15} rows used`;

    if (summary) {
      const stats = [
        ['Total', counts.total || 0],
        ['Pending', (counts.pending || 0) + (counts.checking || 0) + (counts['waiting-space'] || 0)],
        ['Sent', counts.added || 0],
        ['Skipped', counts.skipped || 0],
        ['Attention', counts['needs-attention'] || 0]
      ];
      summary.innerHTML = stats.map(([label, value]) => `<span><strong>${value}</strong> ${label}</span>`).join('');
    }

    const items = snapshot.items || [];
    if (root) {
      root.innerHTML = items.length ? items.map((item, index) => {
        const detail = item.reason || item.title || '';
        const badgeClass = item.status === 'added' ? 'automate-ok'
          : item.status === 'skipped' ? 'automate-skip'
          : item.status === 'needs-attention' ? 'automate-attention'
          : item.status === 'checking' ? 'automate-working'
          : item.status === 'waiting-space' ? 'automate-waiting'
          : '';
        return `<tr>
          <td>${index + 1}</td>
          <td class="automate-link-cell"><div class="automate-link" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>${item.asin ? `<small>${escapeHtml(item.marketplace || '')} · ${escapeHtml(item.asin)}</small>` : ''}</td>
          <td>${item.title ? escapeHtml(item.title) : '<span class="muted">—</span>'}</td>
          <td><span class="automate-status ${badgeClass}">${escapeHtml(statusLabel(item.status))}</span></td>
          <td class="automate-result">${detail ? escapeHtml(detail) : '<span class="muted">Waiting</span>'}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="5"><div class="empty small-empty">Upload an Excel or text list to begin.</div></td></tr>';
    }

    const running = ['running', 'waiting-space'].includes(snapshot.state);
    const hasItems = items.length > 0;
    const start = document.getElementById('automateListStart');
    const pause = document.getElementById('automateListPause');
    const stop = document.getElementById('automateListStop');
    const clear = document.getElementById('automateListClear');
    const upload = document.getElementById('automateListUpload');
    if (start) {
      start.disabled = running || !hasItems;
      start.textContent = snapshot.state === 'paused' ? 'Resume' : snapshot.state === 'completed' ? 'Run Again' : 'Start Import';
    }
    if (pause) pause.disabled = !running;
    if (stop) stop.disabled = !running && snapshot.state !== 'paused';
    if (clear) clear.disabled = running;
    if (upload) upload.disabled = running;
  }

  async function refresh() {
    try {
      render(await api.snapshot());
    } catch (error) {
      const message = document.getElementById('automateListMessage');
      if (message) message.textContent = `Automate List unavailable: ${error.message || error}`;
    }
  }

  async function runAction(button, action, busyText) {
    const original = button?.textContent;
    if (button) { button.disabled = true; if (busyText) button.textContent = busyText; }
    try {
      const result = await action();
      if (result?.snapshot) render(result.snapshot);
      else if (result && !result.canceled) render(result);
      return result;
    } catch (error) {
      alert(error.message || error);
      return null;
    } finally {
      if (button && original) button.textContent = original;
      await refresh();
    }
  }

  document.getElementById('automateListUpload')?.addEventListener('click', async (event) => {
    const result = await runAction(event.currentTarget, () => api.importFile(), 'Reading file…');
    if (result?.canceled) return;
  });

  document.getElementById('automateListStart')?.addEventListener('click', (event) => runAction(event.currentTarget, () => api.start(), 'Starting…'));
  document.getElementById('automateListPause')?.addEventListener('click', (event) => runAction(event.currentTarget, () => api.pause(), 'Pausing…'));
  document.getElementById('automateListStop')?.addEventListener('click', (event) => runAction(event.currentTarget, () => api.stop(), 'Stopping…'));
  document.getElementById('automateListClear')?.addEventListener('click', async (event) => {
    if (!confirm('Clear the imported Automate List? This does not delete rows already sent to Automation.')) return;
    await runAction(event.currentTarget, () => api.clear(), 'Clearing…');
  });

  document.querySelector('.nav[data-view="automateList"]')?.addEventListener('click', refresh);
  window.addEventListener('focus', () => {
    if (document.getElementById('automateList')?.classList.contains('active-view')) refresh();
  });

  const style = document.createElement('style');
  style.textContent = `
    .automate-list-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:18px 0}
    .automate-list-source{margin-top:8px;padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--bg-elevated);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .automate-list-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 14px}
    .automate-list-summary span{padding:7px 10px;border:1px solid var(--border);border-radius:9px;background:var(--bg-elevated);color:var(--muted);font-size:12px}
    .automate-list-summary strong{color:var(--text);margin-right:4px}
    .automate-list-capacity{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:11px 13px;margin:12px 0;border:1px solid var(--border);border-radius:10px;background:var(--surface-2)}
    .automate-list-table{width:100%;border-collapse:separate;border-spacing:0 8px}
    .automate-list-table th{text-align:left;padding:0 10px 6px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
    .automate-list-table td{padding:11px 10px;background:var(--bg-elevated);border-top:1px solid var(--border);border-bottom:1px solid var(--border);vertical-align:top}
    .automate-list-table td:first-child{border-left:1px solid var(--border);border-radius:10px 0 0 10px;width:36px;color:var(--muted)}
    .automate-list-table td:last-child{border-right:1px solid var(--border);border-radius:0 10px 10px 0}
    .automate-link-cell{max-width:360px}.automate-link{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.automate-link-cell small{display:block;color:var(--muted);margin-top:5px}
    .automate-status{display:inline-flex;padding:5px 9px;border-radius:999px;border:1px solid var(--border);font-size:11px;white-space:nowrap}
    .automate-ok{border-color:rgba(47,207,120,.45);color:#78e8a7;background:rgba(47,207,120,.08)}
    .automate-skip{color:var(--muted)}
    .automate-attention{border-color:rgba(239,68,68,.45);color:#ff8c8c;background:rgba(239,68,68,.08)}
    .automate-working{border-color:var(--accent);color:var(--accent-2);background:var(--accent-soft)}
    .automate-waiting{border-color:rgba(245,158,11,.45);color:#fbbf24;background:rgba(245,158,11,.08)}
    .automate-result{max-width:360px;color:var(--muted);font-size:12px;line-height:1.4}
    @media(max-width:980px){.automate-list-table th:nth-child(3),.automate-list-table td:nth-child(3){display:none}.automate-list-capacity{align-items:flex-start;flex-direction:column}}
  `;
  document.head.appendChild(style);

  refresh();
  timer = setInterval(() => {
    if (document.getElementById('automateList')?.classList.contains('active-view') || ['running', 'waiting-space'].includes(lastSnapshot?.state)) refresh();
  }, 1500);
})();
