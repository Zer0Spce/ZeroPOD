(() => {
  const CATEGORY_LABELS = {
    temporary: 'Temporary Files',
    researchCache: 'Research Cache',
    thumbnails: 'Old Thumbnails',
    logs: 'Old Logs',
    publishedCache: 'Published Project Cache',
    buildArtifacts: 'Old Build/Package Artifacts'
  };
  const INTERVALS = [['off','Off'],['1d','Every 1 Day'],['3d','Every 3 Days'],['7d','Every 7 Days'],['2w','Every 2 Weeks'],['3w','Every 3 Weeks'],['monthly','Monthly']];
  const DEFAULTS = ['temporary','researchCache','thumbnails','logs','buildArtifacts'];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);

  function bytes(value) {
    const n = Number(value || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  }
  function date(value) { return value ? new Date(value).toLocaleString() : 'Never'; }

  function installStyles() {
    if (document.getElementById('storageSettingsStyles')) return;
    const style = document.createElement('style');
    style.id = 'storageSettingsStyles';
    style.textContent = `
      .sc-wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.8fr);gap:18px;margin-top:16px}.sc-card{background:var(--surface,#171b21);border:1px solid var(--border,#2a313c);border-radius:14px;padding:16px;box-shadow:var(--shadow-soft)}.sc-total{font-size:30px;font-weight:850;margin:6px 0 14px}.sc-breakdown{display:grid;gap:7px}.sc-line{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--border-soft,#252c35)}.sc-line span:last-child{font-family:Consolas,monospace}.sc-protected{font-size:11px;color:var(--success,#85ddb0);margin-top:10px;line-height:1.5}.sc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.sc-cats{display:grid;gap:8px;margin-top:10px}.sc-cats label{display:flex;gap:8px;align-items:center;font-size:12px}.sc-modal{position:fixed;inset:0;background:rgba(0,0,0,.64);z-index:50;display:none;align-items:center;justify-content:center;padding:20px}.sc-modal.open{display:flex}.sc-dialog{width:min(620px,95vw);max-height:85vh;overflow:auto;background:var(--surface,#15191f);border:1px solid var(--border,#384250);border-radius:14px;padding:18px;box-shadow:0 24px 70px rgba(0,0,0,.45)}.sc-dialog h3{margin-top:0}.sc-warning{padding:10px;border:1px solid rgba(241,215,122,.35);background:rgba(241,215,122,.09);color:var(--warning,#e9d27a);border-radius:9px;font-size:12px;margin:10px 0}.sc-result{margin-top:12px;padding:10px;border-radius:9px;background:var(--bg-elevated,#101419)}.sc-row-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}@media(max-width:980px){.sc-wrap{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function build() {
    installStyles();
    const settings = document.getElementById('settings');
    if (!settings || document.getElementById('storageCachePanel')) return;
    settings.querySelector('.empty')?.remove();
    const root = document.createElement('div');
    root.id = 'storageCachePanel';
    root.innerHTML = `
      <div class="sc-wrap">
        <div class="sc-card">
          <div class="eyebrow">STORAGE & CACHE</div><h3>ZeroPOD Storage Used</h3><div id="scTotal" class="sc-total">Calculating…</div><div id="scBreakdown" class="sc-breakdown"></div>
          <div class="sc-protected">Browser data is protected. Clear Cache never touches browser cache, cookies, Local Storage, IndexedDB, saved logins, sessions, or browser profiles. Projects/final artwork, metadata, Automation state, Saved Research/history, settings, and ChatGPT thread state are also protected.</div>
          <div class="sc-actions"><button id="scRefresh">Refresh Storage Usage</button><button class="danger" id="scClear">Clear Cache</button></div><div id="scCleanupResult" class="sc-result muted">No cleanup run this session.</div>
        </div>
        <div class="sc-card">
          <div class="eyebrow">AUTOMATIC CLEANUP</div><label>Automatic Cleanup<select id="scInterval">${INTERVALS.map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
          <div class="sc-cats" id="scAutoCats">${Object.entries(CATEGORY_LABELS).map(([key,label]) => `<label><input type="checkbox" value="${key}" ${DEFAULTS.includes(key) ? 'checked' : ''} /> ${esc(label)}</label>`).join('')}</div>
          <div class="sc-breakdown" style="margin-top:14px"><div class="sc-line"><span>Last Cleanup</span><span id="scLast">Never</span></div><div class="sc-line"><span>Recovered</span><span id="scRecovered">0 B</span></div><div class="sc-line"><span>Next Cleanup</span><span id="scNext">Not scheduled</span></div></div>
          <div class="sc-actions"><button class="primary" id="scSaveAuto">Save Cleanup Settings</button></div>
        </div>
      </div>
      <div id="scModal" class="sc-modal"><div class="sc-dialog"><div class="heading-row"><div><h3>Clear ZeroPOD Cache</h3><p class="muted">Only known ZeroPOD temporary and unused locations are shown. Browser data is not included.</p></div><button id="scModalX">×</button></div><div id="scManualCats" class="sc-cats"></div><div id="scPublishedWarning" class="sc-warning" hidden>Published Project Cache removes only known disposable staging copies from successfully published jobs. Final artwork, Automation history and listing information are preserved.</div><div class="sc-row-actions"><button id="scCancel">Cancel</button><button class="danger" id="scRunClear">Clear Selected</button></div></div></div>`;
    settings.appendChild(root);
    wire();
  }

  async function refreshUsage() {
    const button = document.getElementById('scRefresh');
    if (button) button.disabled = true;
    try {
      const usage = await window.zeroPOD.storage.usage();
      document.getElementById('scTotal').textContent = bytes(usage.total);
      const rows = [
        ['Temporary Files', usage.temporary], ['Research Cache', usage.researchCache], ['Old Thumbnails', usage.thumbnails], ['Automation / Project Files', usage.automationWorking],
        ['Browser Data (protected)', usage.browserTotalProtected ?? ((usage.browserDisposableCache || 0) + (usage.browserProfilesProtected || 0))], ['Logs', usage.logs],
        ['Published Project Cache', usage.publishedProjectCache], ['Build / Package Artifacts', usage.buildArtifacts], ['Research Database (protected)', usage.researchDatabase], ['App State (protected)', usage.appState]
      ];
      document.getElementById('scBreakdown').innerHTML = rows.map(([label,value]) => `<div class="sc-line"><span>${esc(label)}</span><span>${esc(bytes(value))}</span></div>`).join('');
      applySettings(usage.settings);
      return usage;
    } catch (error) {
      document.getElementById('scTotal').textContent = 'Could not calculate';
      document.getElementById('scCleanupResult').textContent = error.message || String(error);
      return null;
    } finally { if (button) button.disabled = false; }
  }

  function applySettings(settings) {
    if (!settings) return;
    document.getElementById('scInterval').value = settings.cleanupInterval || 'off';
    const selected = new Set((settings.selectedCleanupCategories || DEFAULTS).filter((key) => Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, key)));
    document.querySelectorAll('#scAutoCats input').forEach((input) => { input.checked = selected.has(input.value); });
    document.getElementById('scLast').textContent = date(settings.lastCleanupAt);
    document.getElementById('scRecovered').textContent = bytes(settings.lastCleanupRecoveredBytes || 0);
    document.getElementById('scNext').textContent = settings.nextCleanupAt ? date(settings.nextCleanupAt) : 'Not scheduled';
  }

  function openCleanup(usage) {
    const values = { temporary: usage?.temporary || 0, researchCache: usage?.researchCache || 0, thumbnails: usage?.thumbnails || 0, logs: usage?.logs || 0, publishedCache: usage?.publishedProjectCache || 0, buildArtifacts: usage?.buildArtifacts || 0 };
    document.getElementById('scManualCats').innerHTML = Object.entries(CATEGORY_LABELS).map(([key,label]) => `<label><input type="checkbox" value="${key}" ${DEFAULTS.includes(key) ? 'checked' : ''} /> <span style="flex:1">${esc(label)}</span><span>${esc(bytes(values[key]))}</span></label>`).join('');
    document.querySelectorAll('#scManualCats input').forEach((input) => input.addEventListener('change', () => { document.getElementById('scPublishedWarning').hidden = !document.querySelector('#scManualCats input[value="publishedCache"]')?.checked; }));
    document.getElementById('scPublishedWarning').hidden = true;
    document.getElementById('scModal').classList.add('open');
  }
  function closeCleanup() { document.getElementById('scModal').classList.remove('open'); }

  function wire() {
    document.getElementById('scRefresh').onclick = refreshUsage;
    document.getElementById('scClear').onclick = async () => openCleanup(await refreshUsage());
    document.getElementById('scCancel').onclick = closeCleanup;
    document.getElementById('scModalX').onclick = closeCleanup;
    document.getElementById('scRunClear').onclick = async () => {
      const categories = [...document.querySelectorAll('#scManualCats input:checked')].map((input) => input.value);
      if (!categories.length) return;
      const published = categories.includes('publishedCache');
      if (published && !confirm('Published Project Cache removes disposable staging copies from successfully published jobs. Final artwork, Automation history and listing information will be preserved. Continue?')) return;
      const button = document.getElementById('scRunClear');
      button.disabled = true;
      try {
        const result = await window.zeroPOD.storage.cleanup({ categories, options: { confirmPublishedCache: published } });
        closeCleanup();
        document.getElementById('scCleanupResult').innerHTML = `Cleanup complete. Files removed: <strong>${result.filesRemoved}</strong> · Space recovered: <strong>${esc(bytes(result.bytesRecovered))}</strong> · Protected files skipped: <strong>${result.protectedSkipped}</strong>${result.failed ? ` · Could not remove: <strong>${result.failed}</strong>` : ''}${result.skippedCategories?.length ? ` · Skipped: ${esc(result.skippedCategories.join(', '))}` : ''}`;
        await refreshUsage();
      } catch (error) { document.getElementById('scCleanupResult').textContent = error.message || String(error); }
      finally { button.disabled = false; }
    };
    document.getElementById('scSaveAuto').onclick = async () => {
      const cleanupInterval = document.getElementById('scInterval').value;
      const selectedCleanupCategories = [...document.querySelectorAll('#scAutoCats input:checked')].map((input) => input.value);
      if (selectedCleanupCategories.includes('publishedCache') && !confirm('Automatic Published Project Cache cleanup is optional and only targets known disposable staging copies. Final artwork and Automation records remain protected. Enable this category?')) return;
      const settings = await window.zeroPOD.storage.updateSettings({ cleanupInterval, selectedCleanupCategories });
      applySettings(settings);
      document.getElementById('scCleanupResult').textContent = 'Automatic cleanup settings saved.';
    };
    refreshUsage();
  }

  build();
})();
