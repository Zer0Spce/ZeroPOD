(() => {
  if (window.__zeroPODFlyingCacheInstalled) return;
  window.__zeroPODFlyingCacheInstalled = true;

  const api = window.zeroPOD?.flyingResearch;
  if (!api) return;

  let cachedCount = 0;
  let usingCache = false;

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
    if (!notice) return;
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

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      const old = button.textContent;
      button.textContent = 'Refreshing…';
      usingCache = false;
      try {
        const activeTool = document.querySelector('#frTools button.active');
        if (activeTool) activeTool.click();
        else byId('frSearch')?.click();
        // Flying's own action handler owns the asynchronous search. Refresh the
        // persistent-count indicator after that action has had time to upsert.
        setTimeout(() => updateCachedCount().catch(() => {}), 2500);
      } finally {
        setTimeout(() => {
          button.disabled = false;
          button.textContent = old;
        }, 900);
      }
    });
    return true;
  }

  // Flying Research already persists imported cards in its ResearchStore. The
  // old tab ignored that cache on first open and immediately ran a live search.
  // Intercept only that first-open navigation when cached rows exist, then use
  // the existing Show Imported path so the original renderer owns `items` and
  // all card buttons/selection behavior remain unchanged.
  document.addEventListener('click', (event) => {
    const nav = event.target.closest?.('.nav[data-view="flyingResearch"]');
    if (!nav || cachedCount <= 0 || usingCache) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    usingCache = true;
    activateFlyingView(nav);

    setTimeout(() => {
      const load = byId('frLoad');
      if (load) {
        load.click();
        setTimeout(showCacheNotice, 120);
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

    // Keep the cache count current after imports/searches without reloading the
    // Flying page. This is intentionally lightweight and does not mutate cards.
    document.addEventListener('click', (event) => {
      const id = event.target?.id;
      if (['frCapture', 'frSearch', 'frNextPage'].includes(id)) {
        setTimeout(() => updateCachedCount().catch(() => {}), 2500);
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
