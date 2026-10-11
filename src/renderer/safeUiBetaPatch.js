(() => {
  if (window.__zeroPODSafeUiBetaPatch) return;
  window.__zeroPODSafeUiBetaPatch = true;

  const NEW_CHAT_KEY = 'zeropod.automation.startNewChat';
  let syncingNewChat = false;
  let clearingFailed = false;

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

  async function clearFailedAutomationJobs() {
    if (clearingFailed || !window.zeroPOD?.automation) return;
    clearingFailed = true;
    const button = document.getElementById('automationClearFailedV2');
    if (button) button.disabled = true;
    try {
      const snapshot = await window.zeroPOD.automation.list();
      const failed = (snapshot.rows || []).filter((row) => row.status === 'needs-attention');
      if (!failed.length) {
        if (typeof automationLog === 'function') automationLog('No failed jobs to clear.');
        return;
      }
      if (!confirm(`Clear ${failed.length} failed job${failed.length === 1 ? '' : 's'} from the Automation List?`)) return;
      for (const row of failed) await window.zeroPOD.automation.remove(row.id);
      if (typeof ensureFirstAutomationRow === 'function') await ensureFirstAutomationRow();
      if (typeof refreshAutomationListV2 === 'function') await refreshAutomationListV2();
      if (typeof automationLog === 'function') automationLog(`Cleared ${failed.length} failed job${failed.length === 1 ? '' : 's'}.`, 'ok');
    } catch (error) {
      if (typeof automationLog === 'function') automationLog(`Could not clear failed jobs: ${error.message || error}`, 'error');
    } finally {
      clearingFailed = false;
      if (button) button.disabled = false;
    }
  }

  function ensureAutomationClearFailedButton() {
    const controls = document.querySelector('#automation .az-controls');
    if (!controls || document.getElementById('automationClearFailedV2')) return;
    const button = document.createElement('button');
    button.id = 'automationClearFailedV2';
    button.className = 'secondary';
    button.textContent = 'Clear Failed Jobs';
    button.title = 'Remove all jobs currently marked Failed / Needs Attention.';
    button.addEventListener('click', clearFailedAutomationJobs);
    const clearPublished = document.getElementById('automationClearPublishedV2');
    if (clearPublished) clearPublished.insertAdjacentElement('afterend', button);
    else controls.appendChild(button);
  }

  async function sendResearchCardToWorkflow(key) {
    if (!window.zeroPOD?.research) return;
    try {
      const item = await window.zeroPOD.research.get(key);
      if (!item) throw new Error('Research item could not be found.');
      if (!item.cachedImagePath) throw new Error('This design image is not cached locally yet. Refresh Research and try again.');

      const workflowNav = document.querySelector('.nav[data-view="create"]');
      workflowNav?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const reference = document.getElementById('uwReferencePath') || document.getElementById('referencePath');
      const source = document.getElementById('uwSourceUrl') || document.getElementById('sourceUrl');
      if (!reference || !source) throw new Error('Workflow inputs are not available.');

      reference.value = item.cachedImagePath;
      source.value = item.canonicalUrl || item.amazonUrl || '';
      reference.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('input', { bubbles: true }));
      reference.dispatchEvent(new Event('change', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));

      const status = document.getElementById('uwStatus') || document.getElementById('generationStatus');
      if (status) status.textContent = 'Research design loaded into Workflow. Review the image and Amazon link, then press Start Workflow.';
    } catch (error) {
      const notice = document.getElementById('rsNotice');
      if (notice) notice.innerHTML = `<div class="rs-notice error">${String(error.message || error).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])}</div>`;
    }
  }

  function ensureResearchWorkflowButtons() {
    document.querySelectorAll('#research .rs-card[data-key]').forEach((card) => {
      if (card.querySelector('[data-action="send-workflow"]')) return;
      const actions = card.querySelector('.rs-actions');
      if (!actions) return;
      const button = document.createElement('button');
      button.dataset.action = 'send-workflow';
      button.dataset.key = card.dataset.key;
      button.className = 'primary';
      button.textContent = 'Send to Workflow';
      button.title = 'Load this design image and Amazon link into Workflow.';
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        try { await sendResearchCardToWorkflow(button.dataset.key); }
        finally { button.disabled = false; }
      });
      actions.appendChild(button);
    });
  }

  let syncTimer = null;
  function scheduleEnsure() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      applyResearchBetaLabel();
      ensureAutomationNewChatCheckbox();
      ensureAutomationClearFailedButton();
      ensureResearchWorkflowButtons();
      const activeNav = document.querySelector('.nav.active[data-view]');
      if (activeNav) isolateResearch(activeNav.dataset.view);
    }, 0);
  }

  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnsure();
})();
