(() => {
  if (window.__zeroPODResearchAutomationSafePatch) return;
  window.__zeroPODResearchAutomationSafePatch = true;

  const NEW_CHAT_KEY = 'zeropod.automation.startNewChat';

  function isolateResearch(activeView) {
    const research = document.getElementById('research');
    if (!research) return;
    const show = activeView === 'research';
    research.classList.toggle('active-view', show);
    if (!show) research.querySelector('#rsDetail')?.classList.remove('open');
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest?.('.nav[data-view]');
    if (!nav) return;
    if (nav.dataset.view !== 'research') isolateResearch(nav.dataset.view);
  }, true);

  function applyResearchBetaLabel() {
    const nav = document.querySelector('.nav[data-view="research"]');
    const research = document.getElementById('research');
    if (!nav || !research) return false;
    nav.textContent = 'Research (Beta)';
    const heading = research.querySelector('.heading-row h2');
    if (heading) heading.textContent = 'Research (Beta)';
    const active = document.querySelector('.nav.active[data-view]');
    isolateResearch(active?.dataset.view || 'dashboard');
    return true;
  }

  function newChatEnabled() {
    return localStorage.getItem(NEW_CHAT_KEY) === '1';
  }

  async function syncNewChatRows(enabled) {
    if (!window.zeroPOD?.automation) return;
    const snapshot = await window.zeroPOD.automation.list();
    for (const row of snapshot.rows || []) {
      if (row.status === 'running' || row.status === 'completed') continue;
      if (Boolean(row.newChat) === Boolean(enabled)) continue;
      await window.zeroPOD.automation.update({ rowId: row.id, patch: { newChat: Boolean(enabled) } });
    }
  }

  async function clearFailedJobs() {
    const button = document.getElementById('automationClearFailedV2');
    if (!window.zeroPOD?.automation || !button) return;
    button.disabled = true;
    try {
      const snapshot = await window.zeroPOD.automation.list();
      const failed = (snapshot.rows || []).filter((row) => row.status === 'needs-attention');
      if (!failed.length) {
        if (typeof automationLog === 'function') automationLog('No failed jobs to clear.');
        return;
      }
      if (!window.confirm(`Clear ${failed.length} failed job${failed.length === 1 ? '' : 's'}?`)) return;
      for (const row of failed) await window.zeroPOD.automation.remove(row.id);
      if (typeof ensureFirstAutomationRow === 'function') await ensureFirstAutomationRow();
      if (typeof refreshAutomationListV2 === 'function') await refreshAutomationListV2();
      if (typeof automationLog === 'function') automationLog(`Cleared ${failed.length} failed job${failed.length === 1 ? '' : 's'}.`, 'ok');
    } catch (error) {
      if (typeof automationLog === 'function') automationLog(`Could not clear failed jobs: ${error.message || error}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function installAutomationControls() {
    const controls = document.querySelector('#automation .az-controls');
    if (!controls) return false;

    if (!document.getElementById('automationClearFailedV2')) {
      const button = document.createElement('button');
      button.id = 'automationClearFailedV2';
      button.className = 'secondary';
      button.textContent = 'Clear Failed Jobs';
      button.addEventListener('click', clearFailedJobs);
      controls.appendChild(button);
    }

    if (!document.getElementById('automationStartNewChatWrap')) {
      const label = document.createElement('label');
      label.id = 'automationStartNewChatWrap';
      label.style.display = 'inline-flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';
      label.style.padding = '7px 10px';
      label.style.border = '1px solid #38414e';
      label.style.borderRadius = '9px';
      label.style.background = '#101419';
      label.style.fontSize = '12px';
      label.style.cursor = 'pointer';
      label.title = 'Checked: each queued job starts in a fresh ChatGPT conversation. Unchecked: continue the remembered ChatGPT thread.';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'automationStartNewChatCheck';
      checkbox.checked = newChatEnabled();
      checkbox.style.width = 'auto';

      const text = document.createElement('span');
      text.textContent = 'Start a new chat';
      label.append(checkbox, text);
      controls.appendChild(label);

      checkbox.addEventListener('change', async () => {
        localStorage.setItem(NEW_CHAT_KEY, checkbox.checked ? '1' : '0');
        try { await syncNewChatRows(checkbox.checked); }
        catch (error) { if (typeof automationLog === 'function') automationLog(`Could not update new-chat preference: ${error.message || error}`, 'error'); }
      });

      syncNewChatRows(checkbox.checked).catch(() => {});
    }

    return true;
  }

  function initializeWhenReady() {
    let attempts = 0;
    const timer = setInterval(() => {
      const researchReady = applyResearchBetaLabel();
      const automationReady = installAutomationControls();
      attempts += 1;
      if ((researchReady && automationReady) || attempts >= 100) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeWhenReady, { once: true });
  else initializeWhenReady();
})();
