(() => {
  const seenPolicyProjects = new Set();
  let refreshTimer = null;

  function addAutomationLog(message, kind = 'warn') {
    try {
      if (typeof automationLog === 'function') return automationLog(message, kind);
    } catch {}
    const root = document.getElementById('automationLiveLog');
    if (!root) return;
    const line = document.createElement('div');
    line.className = `az-log-line az-${kind}`;
    line.innerHTML = `<span>${new Date().toLocaleTimeString()}</span><b>${String(message || '')}</b>`;
    root.appendChild(line);
    root.scrollTop = root.scrollHeight;
  }

  function addWorkflowLog(message, kind = 'warn') {
    const root = document.getElementById('uwLog');
    if (!root) return;
    const line = document.createElement('div');
    line.className = `uw-log-line ${kind ? `uw-log-${kind}` : ''}`;
    const time = document.createElement('span');
    time.className = 'uw-log-time';
    time.textContent = new Date().toLocaleTimeString();
    const text = document.createElement('span');
    text.textContent = String(message || '');
    line.append(time, text);
    root.appendChild(line);
    root.scrollTop = root.scrollHeight;
  }

  function installStyles() {
    if (document.getElementById('zeroPodEmergencyControlStyles')) return;
    const style = document.createElement('style');
    style.id = 'zeroPodEmergencyControlStyles';
    style.textContent = `
      .az-status.skipped{border-color:#795f2f;color:#f0cf78;background:#2b2416}
      .zero-force-stop{border-color:#7d343d!important;background:#32171c!important;color:#ffadb5!important}
      .zero-force-stop:hover{filter:brightness(1.08)}
      .zero-control-note{font-size:11px;color:var(--muted);margin-left:4px;align-self:center}
    `;
    document.head.appendChild(style);
  }

  function ensureAutomationButtons() {
    const controls = document.querySelector('#automation .az-controls');
    if (!controls) return;

    if (!document.getElementById('automationClearFailedV2')) {
      const clearFailed = document.createElement('button');
      clearFailed.id = 'automationClearFailedV2';
      clearFailed.className = 'secondary';
      clearFailed.type = 'button';
      clearFailed.textContent = 'Clear Failed Jobs';
      clearFailed.addEventListener('click', async () => {
        clearFailed.disabled = true;
        try {
          const result = await window.zeroPOD.automation.clearFailed();
          addAutomationLog(`Cleared ${result?.removed || 0} failed job${result?.removed === 1 ? '' : 's'}.`);
          if (typeof refreshAutomationListV2 === 'function') await refreshAutomationListV2();
        } catch (error) {
          addAutomationLog(`Could not clear failed jobs: ${error.message || error}`, 'error');
        } finally {
          clearFailed.disabled = false;
        }
      });
      controls.appendChild(clearFailed);
    }

    if (!document.getElementById('automationForceStopV2')) {
      const forceStop = document.createElement('button');
      forceStop.id = 'automationForceStopV2';
      forceStop.className = 'danger zero-force-stop';
      forceStop.type = 'button';
      forceStop.textContent = 'Force Stop Automation';
      forceStop.title = 'Immediately stop the active automation browser/process while preserving the current job for retry.';
      forceStop.addEventListener('click', async () => {
        if (!confirm('Force stop Automation now?\n\nThe active hidden browser will be terminated immediately. Login profiles are preserved, and the current job will be kept at a safe retry point.')) return;
        forceStop.disabled = true;
        forceStop.textContent = 'Force stopping…';
        try {
          const result = await window.zeroPOD.automation.forceStop();
          addAutomationLog(`Automation force stopped.${result?.stoppedRows ? ` ${result.stoppedRows} active job${result.stoppedRows === 1 ? '' : 's'} preserved for retry.` : ''}`, 'warn');
          if (typeof refreshAutomationListV2 === 'function') await refreshAutomationListV2();
        } catch (error) {
          addAutomationLog(`Force stop failed: ${error.message || error}`, 'error');
        } finally {
          forceStop.disabled = false;
          forceStop.textContent = 'Force Stop Automation';
        }
      });
      controls.appendChild(forceStop);
    }
  }

  function ensureWorkflowButton() {
    if (document.getElementById('uwForceStop')) return;
    const start = document.getElementById('uwStart');
    const actions = start?.closest('.uw-review-actions');
    if (!actions) return;

    const button = document.createElement('button');
    button.id = 'uwForceStop';
    button.type = 'button';
    button.className = 'danger zero-force-stop';
    button.textContent = 'Force Stop Workflow';
    button.title = 'Immediately terminate the hidden browser for the active workflow while keeping the project at a safe retry point.';
    button.addEventListener('click', async () => {
      const projectId = localStorage.getItem('zeropod.unified.activeProject.v1');
      if (!projectId) {
        const status = document.getElementById('uwStatus');
        if (status) status.textContent = 'No active workflow project to force stop.';
        return;
      }
      if (!confirm('Force stop the current Workflow now?\n\nThe hidden automation browser will be terminated immediately. Login profiles are preserved and the project will be kept for retry/resume.')) return;
      button.disabled = true;
      button.textContent = 'Force stopping…';
      try {
        await window.zeroPOD.workflow.forceStop(projectId);
        const status = document.getElementById('uwStatus');
        if (status) {
          status.textContent = 'Workflow force stopped. Project preserved at a safe retry point.';
          status.className = 'uw-status validation-warnings';
        }
        addWorkflowLog('Workflow force stopped by user. Project preserved for retry/resume.', 'warn');
      } catch (error) {
        const status = document.getElementById('uwStatus');
        if (status) {
          status.textContent = `Could not force stop workflow: ${error.message || error}`;
          status.className = 'uw-status validation-errors';
        }
        addWorkflowLog(`Force stop failed: ${error.message || error}`, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Force Stop Workflow';
      }
    });
    actions.appendChild(button);
  }

  async function paintAutomationSpecialStates() {
    const root = document.getElementById('automationRowsV2');
    if (!root || !window.zeroPOD?.automation?.list) return;
    let snapshot;
    try { snapshot = await window.zeroPOD.automation.list(); } catch { return; }

    for (const row of snapshot.rows || []) {
      const rowEl = root.querySelector(`[data-row-id="${CSS.escape(String(row.id))}"]`);
      if (!rowEl) continue;
      const badge = rowEl.querySelector('.az-status');
      if (row.status === 'skipped' && badge) {
        badge.textContent = 'Skipped';
        badge.classList.remove('working', 'published', 'failed', 'ready');
        badge.classList.add('skipped');
        badge.title = row.lastError || row.step || 'Skipped';
      }
    }

    const summary = document.getElementById('automationSummaryV2');
    if (summary) {
      let skipped = summary.querySelector('[data-zero-summary="skipped"]');
      const count = (snapshot.rows || []).filter((row) => row.status === 'skipped').length;
      if (count > 0) {
        if (!skipped) {
          skipped = document.createElement('span');
          skipped.dataset.zeroSummary = 'skipped';
          summary.appendChild(skipped);
        }
        skipped.textContent = `Skipped ${count}`;
      } else if (skipped) skipped.remove();
    }
  }

  async function showWorkflowPolicyRejection() {
    const projectId = localStorage.getItem('zeropod.unified.activeProject.v1');
    if (!projectId || seenPolicyProjects.has(projectId) || !window.zeroPOD?.projects?.get) return;
    let project;
    try { project = await window.zeroPOD.projects.get(projectId); } catch { return; }
    if (project?.chatgptError?.code !== 'CHATGPT_POLICY_REJECTED') return;
    seenPolicyProjects.add(projectId);
    const message = project.chatgptError?.message || 'ChatGPT rejected this generation request because it may violate content policies.';
    const status = document.getElementById('uwStatus');
    if (status) {
      status.textContent = `ChatGPT rejected this work. ${message}`;
      status.className = 'uw-status validation-errors';
    }
    addWorkflowLog(`ChatGPT rejected this work. Workflow canceled. ${message}`, 'error');
  }

  async function refreshEnhancements() {
    ensureAutomationButtons();
    ensureWorkflowButton();
    await paintAutomationSpecialStates();
    await showWorkflowPolicyRejection();
  }

  installStyles();
  refreshEnhancements().catch(() => {});
  refreshTimer = setInterval(() => refreshEnhancements().catch(() => {}), 1200);
  window.addEventListener('beforeunload', () => { if (refreshTimer) clearInterval(refreshTimer); });
})();
