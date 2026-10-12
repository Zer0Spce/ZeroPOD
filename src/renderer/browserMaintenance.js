(() => {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
  const bytes = (value) => {
    const n = Number(value || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  };

  function mount() {
    const settings = document.getElementById('settings');
    if (!settings || document.getElementById('browserMaintenancePanel')) return;

    const panel = document.createElement('div');
    panel.id = 'browserMaintenancePanel';
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="heading-row">
        <div>
          <div class="eyebrow">BROWSER MAINTENANCE</div>
          <h3>Automation Browser</h3>
          <p class="muted">Maintenance for ZeroPOD's hidden Chrome automation sessions. Saved logins and browser profiles are preserved.</p>
        </div>
      </div>
      <div class="cards compact-cards">
        <article class="connection-card">
          <div>
            <div class="service-name">Clear Browser Cache</div>
            <div class="last-seen">Removes only disposable browser cache files. Cookies, saved logins, Local Storage, IndexedDB, sessions, and profiles are not deleted.</div>
          </div>
          <button id="clearBrowserCacheOnly" type="button">Clear Browser Cache</button>
        </article>
        <article class="connection-card">
          <div>
            <div class="service-name">Reset Hidden Browser</div>
            <div class="last-seen">Closes ZeroPOD's hidden automation Chrome. The next workflow action starts a fresh hidden browser using the same saved login profile.</div>
          </div>
          <button id="resetHiddenBrowser" type="button">Reset Hidden Browser</button>
        </article>
      </div>
      <div id="browserMaintenanceStatus" class="validation-box muted">No browser maintenance action run this session.</div>`;

    settings.appendChild(panel);

    const status = document.getElementById('browserMaintenanceStatus');
    const cacheButton = document.getElementById('clearBrowserCacheOnly');
    const resetButton = document.getElementById('resetHiddenBrowser');

    cacheButton.addEventListener('click', async () => {
      if (!confirm('Clear only ZeroPOD browser cache?\n\nSaved logins, cookies, Local Storage, IndexedDB, sessions, and browser profiles will be preserved.')) return;
      cacheButton.disabled = true;
      cacheButton.textContent = 'Clearing…';
      status.textContent = 'Closing hidden automation browser and clearing cache…';
      try {
        const result = await window.zeroPOD.storage.clearBrowserCache();
        if (result.failed) {
          status.innerHTML = `Browser cache cleanup finished with <strong>${result.failed}</strong> locked location${result.failed === 1 ? '' : 's'}. Recovered <strong>${esc(bytes(result.bytesRecovered))}</strong>. Saved logins were preserved. If a normal login Chrome window is open, close it and try again.`;
        } else {
          status.innerHTML = `Browser cache cleared. Recovered <strong>${esc(bytes(result.bytesRecovered))}</strong>. Saved logins, cookies, sessions, Local Storage, IndexedDB, and browser profiles were preserved.`;
        }
        try { if (typeof refreshUsage === 'function') await refreshUsage(); } catch {}
      } catch (error) {
        status.textContent = error.message || String(error);
      } finally {
        cacheButton.disabled = false;
        cacheButton.textContent = 'Clear Browser Cache';
      }
    });

    resetButton.addEventListener('click', async () => {
      if (!confirm('Reset the hidden automation browser?\n\nThis closes only ZeroPOD hidden automation Chrome processes. Saved login profiles are preserved.')) return;
      resetButton.disabled = true;
      resetButton.textContent = 'Resetting…';
      status.textContent = 'Resetting hidden automation browser…';
      try {
        const result = await window.zeroPOD.storage.resetHiddenBrowser();
        status.textContent = result.message || 'Hidden automation browser reset. Saved logins were preserved.';
      } catch (error) {
        status.textContent = error.message || String(error);
      } finally {
        resetButton.disabled = false;
        resetButton.textContent = 'Reset Hidden Browser';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
