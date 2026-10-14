(() => {
  if (window.__zeroPODAutomationTargetsInstalled) return;
  window.__zeroPODAutomationTargetsInstalled = true;

  let timer = null;
  let hookedRoot = null;
  const rowsById = new Map();
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }

  function targetsFor(row) {
    const targets = row?.targets && typeof row.targets === 'object' ? row.targets : {};
    return {
      redbubble: Object.prototype.hasOwnProperty.call(targets, 'redbubble') ? Boolean(targets.redbubble) : true,
      spreadshirt: Object.prototype.hasOwnProperty.call(targets, 'spreadshirt') ? Boolean(targets.spreadshirt) : false
    };
  }

  function installStyles() {
    if (document.getElementById('automationPodTargetsStyles')) return;
    const style = document.createElement('style');
    style.id = 'automationPodTargetsStyles';
    style.textContent = `
      #automation .az-row{grid-template-columns:42px minmax(250px,1fr) minmax(250px,1fr) minmax(175px,.62fr) 150px 42px!important}
      .az-targets{display:flex;gap:7px;align-items:center;flex-wrap:wrap;min-width:0}
      .az-target-pill{display:flex;align-items:center;gap:6px;padding:7px 9px;border-radius:9px;background:#171d24;border:1px solid #394251;font-size:11px;color:#b5bfcc;cursor:pointer;user-select:none;white-space:nowrap}
      .az-target-pill input{width:15px;height:15px;margin:0;accent-color:#6875ff}
      .az-target-pill:has(input:checked){border-color:#5969ad;background:#171d31;color:#e2e6ff}
      .az-target-pill.ss:has(input:checked){border-color:#39785d;background:#13261e;color:#9ae2bd}
      .az-targets-label{font-size:9px;font-weight:900;letter-spacing:.05em;color:#6f7b8b;text-transform:uppercase;width:100%;line-height:1}
      .az-target-legend{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:10px 12px;background:#101419;border:1px solid #2a313c;border-radius:10px;font-size:11px;color:#9ca7b6}
      @media(max-width:1150px){#automation .az-row{grid-template-columns:38px 1fr 1fr minmax(160px,.7fr) 125px 38px!important}}
      @media(max-width:900px){#automation .az-row{grid-template-columns:38px 1fr 38px!important}.az-file,.az-url,.az-targets,.az-status{grid-column:2!important}.az-remove{grid-column:3!important;grid-row:1!important}}
    `;
    document.head.appendChild(style);
  }

  function log(message, kind = '') {
    if (typeof window.automationLog === 'function') return window.automationLog(message, kind);
    const root = document.getElementById('automationLiveLog');
    if (!root) return;
    const line = document.createElement('div');
    line.className = `az-log-line az-${kind}`;
    line.innerHTML = `<span>${esc(new Date().toLocaleTimeString())}</span><b>${esc(message)}</b>`;
    root.appendChild(line);
    root.scrollTop = root.scrollHeight;
  }

  function targetMarkup(rowId, fallbackLocked = false) {
    const row = rowsById.get(String(rowId));
    const targets = targetsFor(row);
    const locked = row ? row.status === 'running' || row.status === 'completed' : fallbackLocked;
    return `<div class="az-targets" data-target-row="${esc(rowId)}">
      <div class="az-targets-label">Upload to</div>
      <label class="az-target-pill rb"><input type="checkbox" data-pod-target="redbubble" ${targets.redbubble ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>Redbubble</span></label>
      <label class="az-target-pill ss"><input type="checkbox" data-pod-target="spreadshirt" ${targets.spreadshirt ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>Spreadshirt</span></label>
    </div>`;
  }

  function transformAutomationRows(html) {
    if (typeof html !== 'string' || !html.includes('az-row')) return html;
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('.az-row[data-row-id]').forEach((rowEl) => {
      if (rowEl.querySelector('.az-targets')) return;
      const status = rowEl.querySelector('.az-status');
      if (!status) return;
      const fallbackLocked = Boolean(rowEl.querySelector('.az-remove[disabled]'));
      status.insertAdjacentHTML('beforebegin', targetMarkup(rowEl.dataset.rowId, fallbackLocked));
    });
    return template.innerHTML;
  }

  function hookRowsRoot(root) {
    if (!root || hookedRoot === root || !innerHtmlDescriptor?.get || !innerHtmlDescriptor?.set) return false;
    hookedRoot = root;
    Object.defineProperty(root, 'innerHTML', {
      configurable: true,
      enumerable: false,
      get() { return innerHtmlDescriptor.get.call(this); },
      set(value) { innerHtmlDescriptor.set.call(this, transformAutomationRows(value)); }
    });

    const existing = innerHtmlDescriptor.get.call(root);
    if (existing && root.querySelector('.az-row') && !root.querySelector('.az-targets')) {
      innerHtmlDescriptor.set.call(root, transformAutomationRows(existing));
    }
    return true;
  }

  function polishCopy() {
    const section = document.getElementById('automation');
    if (!section) return;
    const intro = section.querySelector('.az-head .muted');
    if (intro) intro.textContent = 'Queue up to 30 image + source URL jobs. Choose Redbubble, Spreadshirt, or both per row; ZeroPOD publishes only to the selected POD destination(s).';
    const warning = section.querySelector('.az-warning');
    if (warning) warning.textContent = 'Beta full automation skips both manual approval checks and publishes automatically to each checked POD site. Redbubble and Spreadshirt can be selected independently or together. ZeroPOD cannot guarantee product placement, listing accuracy, or the final marketplace result.';
    const panel = section.querySelector('.az-panel');
    if (panel && !document.getElementById('automationPodTargetLegend')) {
      const legend = document.createElement('div');
      legend.id = 'automationPodTargetLegend';
      legend.className = 'az-target-legend';
      legend.innerHTML = '<strong>POD destinations</strong><span>Each row: ✓ Redbubble, ✓ Spreadshirt, or ✓ both. At least one site must stay selected.</span>';
      panel.querySelector('.heading-row')?.insertAdjacentElement('afterend', legend);
    }
    const resultsTitle = section.querySelector('.az-grid .az-panel h3');
    if (resultsTitle && /published results/i.test(resultsTitle.textContent || '')) {
      const detail = resultsTitle.parentElement?.querySelector('.last-seen');
      if (detail) detail.textContent = 'Verified Redbubble / Spreadshirt results for completed rows.';
    }
  }

  async function syncRows() {
    if (!window.zeroPOD?.automation) return;
    const snapshot = await window.zeroPOD.automation.list();
    rowsById.clear();
    for (const row of snapshot.rows || []) rowsById.set(String(row.id), row);
    const root = document.getElementById('automationRowsV2');
    if (root) hookRowsRoot(root);
  }

  async function updateTargets(input) {
    const rowEl = input.closest('.az-row[data-row-id]');
    if (!rowEl) return;
    const rb = rowEl.querySelector('[data-pod-target="redbubble"]');
    const ss = rowEl.querySelector('[data-pod-target="spreadshirt"]');
    if (!rb || !ss) return;

    if (!rb.checked && !ss.checked) {
      input.checked = true;
      log('Each Automation row needs at least one POD destination. The last checked site was kept enabled.', 'warn');
      return;
    }

    const targets = { redbubble: rb.checked, spreadshirt: ss.checked };
    const rowId = String(rowEl.dataset.rowId);
    const cached = rowsById.get(rowId) || { id: rowId };
    rowsById.set(rowId, { ...cached, targets });

    try {
      await window.zeroPOD.automation.update({ rowId, patch: { targets } });
      const selected = [targets.redbubble && 'Redbubble', targets.spreadshirt && 'Spreadshirt'].filter(Boolean).join(' + ');
      log(`Row ${[...rowEl.parentElement.children].indexOf(rowEl) + 1}: POD destination set to ${selected}.`, 'ok');
    } catch (error) {
      log(`Could not update POD destination: ${error.message || error}`, 'error');
      await syncRows().catch(() => {});
    }
  }

  function install() {
    installStyles();
    polishCopy();
    syncRows().catch(() => {});

    document.addEventListener('change', (event) => {
      const input = event.target.closest?.('[data-pod-target]');
      if (!input) return;
      updateTargets(input).catch(() => {});
    }, true);

    // Do not mutate queue rows on a MutationObserver. The Automation screen already
    // refreshes itself on a timer; destination controls are injected synchronously
    // through the row root's innerHTML setter so they exist in the very same paint.
    timer = setInterval(() => {
      const root = document.getElementById('automationRowsV2');
      if (root && root !== hookedRoot) hookRowsRoot(root);
      if (document.getElementById('automation')?.classList.contains('active-view')) {
        syncRows().catch(() => {});
        polishCopy();
      }
    }, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer);
  });
})();
