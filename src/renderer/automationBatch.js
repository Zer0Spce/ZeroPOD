const automationSelected = new Set();
let automationBatchObserver = null;

function ensureAutomationBatchControls() {
  const toolbar = document.querySelector('#automation .automation-toolbar');
  if (!toolbar || document.getElementById('automationBatchControls')) return;
  const controls = document.createElement('div');
  controls.id = 'automationBatchControls';
  controls.className = 'button-row';
  controls.innerHTML = `<button id="automationSelectAll" class="secondary">Select All</button><button id="automationEnableSelected">Enable Selected</button><button id="automationDisableSelected">Disable Selected</button><button id="automationRetrySelected">Retry Selected</button><button id="automationRemoveSelected" class="danger">Remove Selected</button><span id="automationSelectedCount" class="last-seen">0 selected</span>`;
  toolbar.parentNode.insertBefore(controls, toolbar.nextSibling);

  document.getElementById('automationSelectAll').addEventListener('click', selectAllAutomationRows);
  document.getElementById('automationEnableSelected').addEventListener('click', () => setSelectedEnabled(true));
  document.getElementById('automationDisableSelected').addEventListener('click', () => setSelectedEnabled(false));
  document.getElementById('automationRetrySelected').addEventListener('click', retrySelectedAutomationRows);
  document.getElementById('automationRemoveSelected').addEventListener('click', removeSelectedAutomationRows);
}

function updateAutomationSelectedCount() {
  const root = document.getElementById('automationSelectedCount');
  if (root) root.textContent = `${automationSelected.size} selected`;
}

function augmentAutomationTable() {
  const table = document.querySelector('.automation-table');
  if (!table) return;
  const header = table.querySelector('thead tr');
  if (header && !header.querySelector('.batch-select-header')) {
    const th = document.createElement('th');
    th.className = 'batch-select-header';
    th.textContent = 'Select';
    header.insertBefore(th, header.firstChild);
  }

  table.querySelectorAll('tbody tr[data-row-id]').forEach((tr) => {
    if (tr.querySelector('.batch-select-cell')) return;
    const td = document.createElement('td');
    td.className = 'batch-select-cell';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'auto-select';
    input.checked = automationSelected.has(tr.dataset.rowId);
    input.addEventListener('change', () => {
      if (input.checked) automationSelected.add(tr.dataset.rowId);
      else automationSelected.delete(tr.dataset.rowId);
      updateAutomationSelectedCount();
    });
    td.appendChild(input);
    tr.insertBefore(td, tr.firstChild);
  });
  updateAutomationSelectedCount();
}

async function selectAllAutomationRows() {
  const snapshot = await window.zeroPOD.automation.list();
  const selectable = snapshot.rows.filter((row) => row.status !== 'running');
  const allSelected = selectable.length > 0 && selectable.every((row) => automationSelected.has(row.id));
  selectable.forEach((row) => allSelected ? automationSelected.delete(row.id) : automationSelected.add(row.id));
  augmentAutomationTable();
  document.querySelectorAll('#automationRows tr[data-row-id]').forEach((tr) => {
    const box = tr.querySelector('.auto-select');
    if (box) box.checked = automationSelected.has(tr.dataset.rowId);
  });
  updateAutomationSelectedCount();
}

async function setSelectedEnabled(enabled) {
  if (!automationSelected.size) return;
  for (const rowId of automationSelected) {
    await window.zeroPOD.automation.update({ rowId, patch: { enabled } });
  }
  await refreshAutomationList();
  setTimeout(augmentAutomationTable, 50);
}

async function retrySelectedAutomationRows() {
  if (!automationSelected.size) return;
  const snapshot = await window.zeroPOD.automation.list();
  const selectedRows = snapshot.rows.filter((row) => automationSelected.has(row.id));
  for (const row of selectedRows) {
    if (row.status !== 'needs-attention') continue;
    if (row.projectId) {
      await window.zeroPOD.automation.update({ rowId: row.id, patch: { status: 'ready', step: 'Retry queued', lastError: null } });
    } else {
      const complete = Boolean(row.referenceImage && row.amazonLink);
      await window.zeroPOD.automation.update({ rowId: row.id, patch: {
        status: complete ? 'pending' : 'draft',
        step: complete ? 'Waiting' : 'Complete image + Amazon link',
        lastError: null
      }});
    }
  }
  await refreshAutomationList();
  setTimeout(augmentAutomationTable, 50);
}

async function removeSelectedAutomationRows() {
  if (!automationSelected.size) return;
  if (!confirm(`Remove ${automationSelected.size} selected automation row${automationSelected.size === 1 ? '' : 's'}? Linked projects will remain in Projects.`)) return;
  const snapshot = await window.zeroPOD.automation.list();
  const removable = snapshot.rows.filter((row) => automationSelected.has(row.id) && row.status !== 'running');
  for (const row of removable) await window.zeroPOD.automation.remove(row.id);
  removable.forEach((row) => automationSelected.delete(row.id));
  await refreshAutomationList();
  setTimeout(augmentAutomationTable, 50);
}

function observeAutomationTable() {
  if (automationBatchObserver) return;
  const root = document.getElementById('automationRows');
  if (!root) return;
  automationBatchObserver = new MutationObserver(() => augmentAutomationTable());
  automationBatchObserver.observe(root, { childList: true });
}

ensureAutomationBatchControls();
observeAutomationTable();
augmentAutomationTable();
