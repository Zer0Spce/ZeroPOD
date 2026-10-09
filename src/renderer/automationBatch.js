const automationSelected = new Set();
let automationBatchObserver = null;
const PRESET_KEY = 'zeropod.automation.presets.v1';

function loadAutomationPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); }
  catch { return []; }
}

function saveAutomationPresets(presets) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets.slice(0, 50)));
}

function renderPresetOptions() {
  const select = document.getElementById('automationPresetSelect');
  if (!select) return;
  const current = select.value;
  const presets = loadAutomationPresets();
  select.innerHTML = '<option value="">Instruction preset…</option>' + presets.map((preset, index) => `<option value="${index}">${preset.name}</option>`).join('');
  if (current && presets[Number(current)]) select.value = current;
}

function ensureAutomationBatchControls() {
  const toolbar = document.querySelector('#automation .automation-toolbar');
  if (!toolbar || document.getElementById('automationBatchControls')) return;

  const io = document.createElement('div');
  io.id = 'automationSpreadsheetControls';
  io.className = 'button-row';
  io.innerHTML = `<button id="automationImportXlsx">Import Excel</button><button id="automationExportXlsx">Export Excel</button><span class="last-seen">XLSX uses the same image + Amazon/source link + notes columns as CSV.</span>`;
  toolbar.parentNode.insertBefore(io, toolbar.nextSibling);

  const controls = document.createElement('div');
  controls.id = 'automationBatchControls';
  controls.className = 'button-row';
  controls.innerHTML = `<button id="automationSelectAll" class="secondary">Select All</button><button id="automationEnableSelected">Enable Selected</button><button id="automationDisableSelected">Disable Selected</button><button id="automationRetrySelected">Retry Selected</button><button id="automationMoveTop">Move Top</button><button id="automationMoveUp">↑ Up</button><button id="automationMoveDown">↓ Down</button><button id="automationMoveBottom">Move Bottom</button><button id="automationRemoveSelected" class="danger">Remove Selected</button><span id="automationSelectedCount" class="last-seen">0 selected</span>`;
  io.parentNode.insertBefore(controls, io.nextSibling);

  const presets = document.createElement('div');
  presets.id = 'automationPresetControls';
  presets.className = 'button-row';
  presets.innerHTML = `<select id="automationPresetSelect"><option value="">Instruction preset…</option></select><button id="automationApplyPreset">Apply to Selected</button><button id="automationSavePreset">Save Notes as Preset</button><button id="automationDeletePreset" class="secondary">Delete Preset</button><span class="last-seen">Presets store generation notes only, never images, links, passwords, or sessions.</span>`;
  controls.parentNode.insertBefore(presets, controls.nextSibling);

  document.getElementById('automationSelectAll').addEventListener('click', selectAllAutomationRows);
  document.getElementById('automationEnableSelected').addEventListener('click', () => setSelectedEnabled(true));
  document.getElementById('automationDisableSelected').addEventListener('click', () => setSelectedEnabled(false));
  document.getElementById('automationRetrySelected').addEventListener('click', retrySelectedAutomationRows);
  document.getElementById('automationMoveTop').addEventListener('click', () => moveSelectedAutomationRows('top'));
  document.getElementById('automationMoveUp').addEventListener('click', () => moveSelectedAutomationRows('up'));
  document.getElementById('automationMoveDown').addEventListener('click', () => moveSelectedAutomationRows('down'));
  document.getElementById('automationMoveBottom').addEventListener('click', () => moveSelectedAutomationRows('bottom'));
  document.getElementById('automationRemoveSelected').addEventListener('click', removeSelectedAutomationRows);
  document.getElementById('automationImportXlsx').addEventListener('click', importAutomationXlsx);
  document.getElementById('automationExportXlsx').addEventListener('click', exportAutomationXlsx);
  document.getElementById('automationApplyPreset').addEventListener('click', applyAutomationPreset);
  document.getElementById('automationSavePreset').addEventListener('click', saveCurrentAutomationPreset);
  document.getElementById('automationDeletePreset').addEventListener('click', deleteAutomationPreset);
  renderPresetOptions();
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

async function refreshBatchTable() {
  await refreshAutomationList();
  setTimeout(augmentAutomationTable, 50);
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
  await refreshBatchTable();
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
  await refreshBatchTable();
}

async function moveSelectedAutomationRows(direction) {
  if (!automationSelected.size) return;
  try {
    await window.zeroPOD.automation.move({ rowIds: [...automationSelected], direction });
    await refreshBatchTable();
  } catch (error) {
    alert(`Could not reorder selected rows: ${error.message || error}`);
  }
}

async function removeSelectedAutomationRows() {
  if (!automationSelected.size) return;
  if (!confirm(`Remove ${automationSelected.size} selected automation row${automationSelected.size === 1 ? '' : 's'}? Linked projects will remain in Projects.`)) return;
  const snapshot = await window.zeroPOD.automation.list();
  const removable = snapshot.rows.filter((row) => automationSelected.has(row.id) && row.status !== 'running');
  for (const row of removable) await window.zeroPOD.automation.remove(row.id);
  removable.forEach((row) => automationSelected.delete(row.id));
  await refreshBatchTable();
}

async function importAutomationXlsx() {
  try {
    const result = await window.zeroPOD.automation.importXlsx();
    if (!result.canceled) {
      await refreshBatchTable();
      alert(`Imported ${result.imported} row${result.imported === 1 ? '' : 's'} from Excel.`);
    }
  } catch (error) { alert(`Excel import failed: ${error.message || error}`); }
}

async function exportAutomationXlsx() {
  try {
    const result = await window.zeroPOD.automation.exportXlsx();
    if (!result.canceled) alert('Automation List exported to Excel.');
  } catch (error) { alert(`Excel export failed: ${error.message || error}`); }
}

async function saveCurrentAutomationPreset() {
  const snapshot = await window.zeroPOD.automation.list();
  const selectedRows = snapshot.rows.filter((row) => automationSelected.has(row.id));
  const notes = selectedRows.find((row) => String(row.notes || '').trim())?.notes || '';
  const fallback = document.getElementById('automationBulkPaste')?.value?.trim() || '';
  const presetNotes = notes || fallback;
  if (!presetNotes) return alert('Select a row that already has notes, or type instructions in Bulk Paste first.');
  const name = prompt('Preset name:');
  if (!name?.trim()) return;
  const presets = loadAutomationPresets();
  const existing = presets.findIndex((preset) => preset.name.toLowerCase() === name.trim().toLowerCase());
  const next = { name: name.trim(), notes: presetNotes, updatedAt: new Date().toISOString() };
  if (existing >= 0) presets[existing] = next; else presets.push(next);
  saveAutomationPresets(presets);
  renderPresetOptions();
}

async function applyAutomationPreset() {
  if (!automationSelected.size) return alert('Select one or more queue rows first.');
  const index = Number(document.getElementById('automationPresetSelect')?.value);
  const presets = loadAutomationPresets();
  if (!Number.isInteger(index) || !presets[index]) return alert('Choose an instruction preset first.');
  for (const rowId of automationSelected) {
    await window.zeroPOD.automation.update({ rowId, patch: { notes: presets[index].notes } });
  }
  await refreshBatchTable();
}

function deleteAutomationPreset() {
  const select = document.getElementById('automationPresetSelect');
  const index = Number(select?.value);
  const presets = loadAutomationPresets();
  if (!Number.isInteger(index) || !presets[index]) return;
  if (!confirm(`Delete preset “${presets[index].name}”?`)) return;
  presets.splice(index, 1);
  saveAutomationPresets(presets);
  renderPresetOptions();
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
