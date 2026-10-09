let automationPoll = null;

function automationEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function automationStatusLabel(status) {
  return ({
    draft: 'Draft', pending: 'Pending', ready: 'Ready', running: 'Running',
    'awaiting-review': 'Awaiting Review', 'awaiting-publish-review': 'Final Review',
    'needs-attention': 'Needs Attention', completed: 'Completed', skipped: 'Skipped'
  })[status] || status;
}

function renderRecoveryBanner(snapshot) {
  let banner = document.getElementById('automationRecoveryBanner');
  const summary = document.getElementById('automationSummary');
  if (!banner && summary) {
    banner = document.createElement('div');
    banner.id = 'automationRecoveryBanner';
    banner.className = 'automation-recovery-banner';
    summary.parentNode.insertBefore(banner, summary);
  }
  if (!banner) return;

  if (!snapshot.recovery) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  banner.hidden = false;
  banner.innerHTML = `<strong>Recovered after restart</strong><span>${automationEscape(snapshot.recovery.message || 'ZeroPOD restored the Automation List safely.')}</span>`;
}

async function refreshAutomationList() {
  const root = document.getElementById('automationRows');
  if (!root || !window.zeroPOD?.automation) return;
  const snapshot = await window.zeroPOD.automation.list();
  const state = document.getElementById('automationState');
  state.textContent = snapshot.state.charAt(0).toUpperCase() + snapshot.state.slice(1);
  state.className = `queue-state queue-state-${snapshot.state}`;
  const startButton = document.getElementById('automationStart');
  if (startButton) startButton.textContent = snapshot.state === 'paused' ? 'Resume Queue' : 'Start Queue';
  renderRecoveryBanner(snapshot);

  const counts = snapshot.counts || {};
  document.getElementById('automationSummary').innerHTML = [
    ['Total', counts.total || 0],
    ['Pending', (counts.pending || 0) + (counts.ready || 0)],
    ['Running', counts.running || 0],
    ['Review', (counts['awaiting-review'] || 0) + (counts['awaiting-publish-review'] || 0)],
    ['Attention', counts['needs-attention'] || 0],
    ['Completed', counts.completed || 0]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');

  if (!snapshot.rows.length) {
    root.innerHTML = '<tr><td colspan="8" class="automation-empty">No jobs yet. Add rows, images, paste a batch, or import CSV.</td></tr>';
    return;
  }

  root.innerHTML = snapshot.rows.map((row) => `<tr data-row-id="${automationEscape(row.id)}" class="automation-row status-${automationEscape(row.status)}">
    <td><input class="auto-enabled" type="checkbox" ${row.enabled !== false ? 'checked' : ''}></td>
    <td><div class="auto-path-cell"><input class="auto-image" value="${automationEscape(row.referenceImage)}" placeholder="C:\\Designs\\design.png"><button class="auto-browse small-button">…</button></div></td>
    <td><input class="auto-link" value="${automationEscape(row.amazonLink)}" placeholder="https://amazon.com/..."></td>
    <td><input class="auto-notes" value="${automationEscape(row.notes)}" placeholder="Optional instructions"></td>
    <td><span class="stage-badge auto-status-${automationEscape(row.status)}">${automationEscape(automationStatusLabel(row.status))}</span>${row.lastError ? `<div class="auto-error" title="${automationEscape(row.lastError)}">${automationEscape(row.lastError)}</div>` : ''}</td>
    <td>${automationEscape(row.step || 'Waiting')}${row.recoveredAt ? '<div class="auto-recovered">Recovered</div>' : ''}</td>
    <td>${row.projectId ? `<button class="auto-project small-button" data-project="${automationEscape(row.projectId)}">Projects</button>` : '—'}</td>
    <td><div class="auto-actions">${row.status === 'needs-attention' ? '<button class="auto-retry small-button">Retry</button>' : ''}<button class="auto-remove danger small-button">Remove</button></div></td>
  </tr>`).join('');

  root.querySelectorAll('tr[data-row-id]').forEach((tr) => {
    const rowId = tr.dataset.rowId;
    const save = async () => {
      await window.zeroPOD.automation.update({ rowId, patch: {
        enabled: tr.querySelector('.auto-enabled').checked,
        referenceImage: tr.querySelector('.auto-image').value.trim(),
        amazonLink: tr.querySelector('.auto-link').value.trim(),
        notes: tr.querySelector('.auto-notes').value.trim()
      }});
      await refreshAutomationList();
    };
    tr.querySelector('.auto-enabled').addEventListener('change', save);
    tr.querySelectorAll('.auto-image,.auto-link,.auto-notes').forEach((input) => input.addEventListener('change', save));
    tr.querySelector('.auto-browse').addEventListener('click', async () => {
      const file = await window.zeroPOD.files.chooseReference();
      if (!file) return;
      tr.querySelector('.auto-image').value = file;
      await save();
    });
    tr.querySelector('.auto-retry')?.addEventListener('click', async () => {
      await window.zeroPOD.automation.update({ rowId, patch: { status: 'ready', step: 'Retry queued', lastError: null } });
      await refreshAutomationList();
    });
    tr.querySelector('.auto-remove').addEventListener('click', async () => {
      if (!confirm('Remove this automation row? The linked ZeroPOD project, if any, will remain in Projects.')) return;
      await window.zeroPOD.automation.remove(rowId);
      await refreshAutomationList();
    });
    const open = tr.querySelector('.auto-project');
    if (open) open.addEventListener('click', () => {
      document.querySelector('.nav[data-view="projects"]')?.click();
    });
  });
}

async function automationAddRows(rows) {
  if (!rows.length) return;
  await window.zeroPOD.automation.add(rows);
  await refreshAutomationList();
}

function parseBulkPaste(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/);
    if (parts.length === 1 && /^https?:\/\//i.test(parts[0].trim())) return { amazonLink: parts[0].trim() };
    return {
      referenceImage: (parts[0] || '').trim(),
      amazonLink: (parts[1] || '').trim(),
      notes: parts.slice(2).join(' ').trim()
    };
  });
}

async function applyBulkPaste() {
  const box = document.getElementById('automationBulkPaste');
  const parsed = parseBulkPaste(box.value);
  if (!parsed.length) return;

  const onlyLinks = parsed.every((row) => row.amazonLink && !row.referenceImage);
  if (onlyLinks) {
    const snapshot = await window.zeroPOD.automation.list();
    const blanks = snapshot.rows.filter((row) => row.referenceImage && !row.amazonLink && !row.projectId);
    if (blanks.length < parsed.length) {
      alert(`There are only ${blanks.length} image rows without links, but you pasted ${parsed.length} links.`);
      return;
    }
    for (let i = 0; i < parsed.length; i += 1) {
      await window.zeroPOD.automation.update({ rowId: blanks[i].id, patch: { amazonLink: parsed[i].amazonLink } });
    }
  } else {
    await automationAddRows(parsed);
  }
  box.value = '';
  await refreshAutomationList();
}

function startAutomationPolling() {
  if (automationPoll) return;
  automationPoll = setInterval(() => {
    const visible = document.getElementById('automation')?.classList.contains('active-view');
    if (visible) refreshAutomationList().catch(() => {});
  }, 2500);
}

const automationNav = document.querySelector('.nav[data-view="automation"]');
if (automationNav) automationNav.addEventListener('click', () => refreshAutomationList().catch(() => {}));

document.getElementById('automationAddRow')?.addEventListener('click', () => automationAddRows([{ referenceImage: '', amazonLink: '', notes: '' }]));
document.getElementById('automationAddImages')?.addEventListener('click', async () => {
  const paths = await window.zeroPOD.files.chooseMultipleReferences();
  await automationAddRows(paths.map((referenceImage) => ({ referenceImage, amazonLink: '', notes: '' })));
});
document.getElementById('automationApplyPaste')?.addEventListener('click', applyBulkPaste);
document.getElementById('automationImportCsv')?.addEventListener('click', async () => {
  try {
    const result = await window.zeroPOD.automation.importCsv();
    if (!result.canceled) await refreshAutomationList();
  } catch (error) { alert(`CSV import failed: ${error.message || error}`); }
});
document.getElementById('automationExportCsv')?.addEventListener('click', async () => {
  try { await window.zeroPOD.automation.exportCsv(); }
  catch (error) { alert(`CSV export failed: ${error.message || error}`); }
});
document.getElementById('automationClearCompleted')?.addEventListener('click', async () => {
  await window.zeroPOD.automation.clearCompleted();
  await refreshAutomationList();
});
document.getElementById('automationStart')?.addEventListener('click', async () => {
  try {
    await window.zeroPOD.automation.start();
    await refreshAutomationList();
  } catch (error) {
    alert(`Queue could not start: ${error.message || error}`);
  }
});
document.getElementById('automationPause')?.addEventListener('click', async () => {
  await window.zeroPOD.automation.pause();
  await refreshAutomationList();
});
document.getElementById('automationStop')?.addEventListener('click', async () => {
  await window.zeroPOD.automation.stop();
  await refreshAutomationList();
});

startAutomationPolling();
refreshAutomationList().catch(() => {});
