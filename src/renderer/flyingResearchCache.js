(() => {
  if (window.__zeroPODFlyingCacheInstalled) return;
  window.__zeroPODFlyingCacheInstalled = true;

  const api = window.zeroPOD?.flyingResearch;
  if (!api) return;

  let cachedCount = 0;
  let cacheTimer = null;

  const byId = (id) => document.getElementById(id);

  async function updateCachedCount() {
    try {
      const rows = await api.list();
      cachedCount = Array.isArray(rows) ? rows.length : 0;
    } catch {
      cachedCount = 0;
    }
    return cachedCount;
  }

  function activateFlyingView(nav) {
    document.querySelectorAll('.nav').forEach((el) => el.classList.toggle('active', el === nav));
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active-view', el.id === 'flyingResearch'));
  }

  function showCacheNotice() {
    const notice = byId('frNotice');
    if (!notice || cachedCount <= 0) return;
    notice.textContent = `${cachedCount} cached Flying Research design${cachedCount === 1 ? '' : 's'} restored. Click Refresh to fetch the latest results from Flying.`;
    notice.classList.remove('error');
  }

  function installRefreshButton() {
    if (byId('frRefresh')) return true;
    const capture = byId('frCapture');
    if (!capture?.parentElement) return false;

    const button = document.createElement('button');
    button.id = 'frRefresh';
    button.className = 'secondary';
    button.textContent = 'Refresh';
    button.title = 'Fetch the current Flying Research tool again and replace the cached view.';
    capture.insertAdjacentElement('afterend', button);

    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      const old = button.textContent;
      button.textContent = 'Refreshing…';

      const activeTool = document.querySelector('#frTools button.active');
      if (activeTool) activeTool.click();
      else byId('frSearch')?.click();

      // Flying's own action handler owns the asynchronous refresh and persists
      // imported cards through ResearchStore. We only update the cache indicator.
      setTimeout(() => updateCachedCount().catch(() => {}), 2500);
      setTimeout(() => {
        button.disabled = false;
        button.textContent = old;
      }, 900);
    });
    return true;
  }

  // Flying Research already persists imported cards in ResearchStore. The old
  // tab ignored that cache whenever the dynamic tab was opened after a restart
  // and immediately performed a live search. When cached rows exist, always use
  // the existing Show Imported action instead. A live network refresh now occurs
  // only when the user presses the explicit Refresh button (or starts a search).
  document.addEventListener('click', (event) => {
    const nav = event.target.closest?.('.nav[data-view="flyingResearch"]');
    if (!nav || cachedCount <= 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    activateFlyingView(nav);

    setTimeout(() => {
      const load = byId('frLoad');
      if (load) {
        load.click();
        setTimeout(showCacheNotice, 250);
      }
    }, 0);
  }, true);

  function install() {
    updateCachedCount().catch(() => {});
    if (!installRefreshButton()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (installRefreshButton() || attempts >= 50) clearInterval(timer);
      }, 200);
    }

    document.addEventListener('click', (event) => {
      const id = event.target?.id;
      if (['frCapture', 'frSearch', 'frNextPage'].includes(id)) {
        setTimeout(() => updateCachedCount().catch(() => {}), 2500);
      }
    }, true);

    // Initial automatic searches do not originate from a renderer button click,
    // so keep the persisted row count synchronized while the tab is active too.
    cacheTimer = setInterval(() => {
      if (byId('flyingResearch')?.classList.contains('active-view')) {
        updateCachedCount().catch(() => {});
      }
    }, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.addEventListener('beforeunload', () => {
    if (cacheTimer) clearInterval(cacheTimer);
  });
})();
