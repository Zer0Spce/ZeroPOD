(() => {
  if (window.__zeroPODSafeUiBetaPatch) return;
  window.__zeroPODSafeUiBetaPatch = true;

  const NEW_CHAT_KEY = 'zeropod.automation.startNewChat';
  let syncingNewChat = false;

  function researchSection() {
    return document.getElementById('research');
  }

  function researchNav() {
    return document.querySelector('.nav[data-view="research"]');
  }

  function applyResearchBetaLabel() {
    const nav = researchNav();
    if (nav && nav.textContent !== 'Research (Beta)') nav.textContent = 'Research (Beta)';
    const section = researchSection();
    const heading = section?.querySelector('.heading-row h2');
    if (heading && heading.textContent !== 'Research (Beta)') heading.textContent = 'Research (Beta)';
  }

  function isolateResearch(activeView) {
    const section = researchSection();
    if (!section) return;
    const showingResearch = activeView === 'research';
    section.classList.toggle('active-view', showingResearch);
    if (!showingResearch) section.querySelector('#rsDetail')?.classList.remove('open');
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest?.('.nav[data-view]');
    if (!nav) return;
    queueMicrotask(() => isolateResearch(nav.dataset.view));
  });

  function preferenceEnabled() {
    return localStorage.getItem(NEW_CHAT_KEY) === '1';
  }

  async function syncAutomationRowsNewChat(enabled) {
    if (syncingNewChat || !window.zeroPOD?.automation) return;
    syncingNewChat = true;
    const start = document.getElementById('automationStartV2');
    if (start) start.disabled = true;
    try {
      const snapshot = await window.zeroPOD.automation.list();
      for (const row of snapshot.rows || []) {
        if (row.status === 'running' || row.status === 'completed') continue;
        if (Boolean(row.newChat) === Boolean(enabled)) continue;
        await window.zeroPOD.automation.update({ rowId: row.id, patch: { newChat: Boolean(enabled) } });
      }
    } finally {
      syncingNewChat = false;
      if (start) start.disabled = false;
    }
  }

  function ensureAutomationNewChatCheckbox() {
    const controls = document.querySelector('#automation .az-controls');
    if (!controls || document.getElementById('automationStartNewChatWrap')) return;

    const label = document.createElement('label');
    label.id = 'automationStartNewChatWrap';
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    label.style.padding = '7px 10px';
    label.style.border = '1px solid #38414e';
    label.style.borderRadius = '9px';
    label.style.background = '#101419';
    label.style.color = '#c6ced9';
    label.style.fontSize = '12px';
    label.style.cursor = 'pointer';
    label.title = 'Checked: each queued job begins in a fresh ChatGPT conversation. Unchecked: ZeroPOD continues the last remembered ChatGPT thread.';

    const checkbox = document.createElement('input');
    checkbox.id = 'automationStartNewChatCheck';
    checkbox.type = 'checkbox';
    checkbox.checked = preferenceEnabled();
    checkbox.style.width = 'auto';

    const text = document.createElement('span');
    text.textContent = 'Start a new chat';

    label.append(checkbox, text);
    controls.appendChild(label);

    checkbox.addEventListener('change', async () => {
      localStorage.setItem(NEW_CHAT_KEY, checkbox.checked ? '1' : '0');
      await syncAutomationRowsNewChat(checkbox.checked);
    });

    syncAutomationRowsNewChat(checkbox.checked).catch(() => {});
  }

  let syncTimer = null;
  function scheduleEnsure() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      applyResearchBetaLabel();
      ensureAutomationNewChatCheckbox();
      const activeNav = document.querySelector('.nav.active[data-view]');
      if (activeNav) isolateResearch(activeNav.dataset.view);
    }, 0);
  }

  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnsure();
})();
