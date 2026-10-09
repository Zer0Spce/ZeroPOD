function readinessBadge(label, state, detail) {
  const tone = state === 'ok' ? 'readiness-ok' : state === 'warn' ? 'readiness-warn' : 'readiness-bad';
  return `<div class="readiness-item ${tone}"><div><strong>${label}</strong><span>${detail}</span></div><b>${state === 'ok' ? 'Ready' : state === 'warn' ? 'Check' : 'Action'}</b></div>`;
}

async function renderReadinessCenter() {
  const root = document.getElementById('readinessCenter');
  if (!root) return;
  root.innerHTML = '<div class="muted">Checking ZeroPOD readiness…</div>';
  try {
    const [connections, health, automation, projects] = await Promise.all([
      window.zeroPOD.connections.list(),
      window.zeroPOD.workspace.health(),
      window.zeroPOD.automation.list(),
      window.zeroPOD.projects.list()
    ]);

    const connectionEntries = Object.values(connections);
    const loginNeeded = connectionEntries.filter((item) => item.authStatus === 'needs-login');
    const unverified = connectionEntries.filter((item) => item.authStatus === 'unknown');
    const reviewCount = projects.filter((p) => p.status === 'awaiting-review').length;
    const publishCount = projects.filter((p) => ['redbubble-review', 'redbubble-publish-pending'].includes(p.status)).length;
    const attentionCount = projects.filter((p) => String(p.status || '').includes('recovery-needed')).length;
    const drafts = automation.rows.filter((row) => row.status === 'draft').length;

    const connectionState = loginNeeded.length ? 'bad' : unverified.length ? 'warn' : 'ok';
    const connectionDetail = loginNeeded.length
      ? `${loginNeeded.length} service${loginNeeded.length === 1 ? '' : 's'} need login`
      : unverified.length
        ? `${unverified.length} saved session${unverified.length === 1 ? '' : 's'} not recently verified`
        : 'All configured sessions verified';
    const healthState = health.errors.length ? 'bad' : health.warnings.length ? 'warn' : 'ok';
    const queueState = automation.state === 'running' ? 'ok' : automation.state === 'paused' ? 'warn' : 'ok';

    root.innerHTML = `
      <div class="readiness-grid">
        ${readinessBadge('Connections', connectionState, connectionDetail)}
        ${readinessBadge('Workspace', healthState, `${health.errors.length} errors · ${health.warnings.length} warnings`)}
        ${readinessBadge('Automation List', queueState, `${automation.rows.length} rows · ${drafts} drafts · ${automation.state}`)}
        ${readinessBadge('Human Gates', attentionCount ? 'warn' : 'ok', `${reviewCount} image reviews · ${publishCount} publish reviews · ${attentionCount} recovery items`)}
      </div>
      <div class="readiness-actions">
        <button id="readinessRefresh">Refresh Readiness</button>
        <button id="readinessHealth">Run Health Check</button>
        <button id="readinessDiagnostics" class="secondary">Export Diagnostics</button>
      </div>`;

    document.getElementById('readinessRefresh')?.addEventListener('click', renderReadinessCenter);
    document.getElementById('readinessHealth')?.addEventListener('click', async () => {
      const result = await window.zeroPOD.workspace.health();
      alert(`Workspace Health\n\nErrors: ${result.errors.length}\nWarnings: ${result.warnings.length}\nProjects: ${result.projectCount}\nQueue rows: ${result.queueRowCount}`);
      renderReadinessCenter();
    });
    document.getElementById('readinessDiagnostics')?.addEventListener('click', async () => {
      const result = await window.zeroPOD.workspace.diagnostics();
      if (!result.canceled) alert(`Privacy-safe diagnostics exported.\n\n${result.path}`);
    });
  } catch (error) {
    root.innerHTML = `<div class="validation-errors">Readiness check failed: ${error.message || error}</div>`;
  }
}

function ensureReadinessCenter() {
  const dashboard = document.getElementById('dashboard');
  const stats = document.getElementById('dashboardStats');
  if (!dashboard || !stats || document.getElementById('readinessPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'readinessPanel';
  panel.className = 'panel readiness-panel';
  panel.innerHTML = '<div class="section-title"><h3>1.0 Readiness Center</h3><span>Preflight, health, and support snapshot</span></div><div id="readinessCenter" class="readiness-center"></div>';
  stats.parentNode.insertBefore(panel, stats.nextSibling);
  renderReadinessCenter();
}

function ensureThreadPreferenceControl() {
  const startButton = document.getElementById('startGeneration');
  if (!startButton) return;

  // Replace the old NEW CHAT push button with a persistent per-generation choice.
  document.getElementById('newChatButton')?.remove();
  if (document.getElementById('startNewChatCheck')) return;

  const wrapper = document.createElement('label');
  wrapper.id = 'newChatPreference';
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '8px';
  wrapper.style.marginLeft = '12px';
  wrapper.style.fontWeight = '500';
  wrapper.style.color = '#aeb6c2';
  wrapper.style.cursor = 'pointer';
  wrapper.innerHTML = '<input id="startNewChatCheck" type="checkbox" style="width:auto" /> New Chat for this generation';
  startButton.insertAdjacentElement('afterend', wrapper);

  // app.js already owns the normal Start Generation workflow. When checked, this
  // capture-phase hook prepares a fresh ChatGPT composer first, then replays the
  // same click so the existing generation path remains untouched.
  startButton.addEventListener('click', async (event) => {
    const checkbox = document.getElementById('startNewChatCheck');
    if (!checkbox?.checked || startButton.dataset.newChatPrimed === '1') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const status = document.getElementById('generationStatus');
    startButton.disabled = true;
    if (status) status.textContent = 'Opening a fresh ChatGPT chat for this generation…';

    try {
      await window.zeroPOD.generation.newChat();
      startButton.dataset.newChatPrimed = '1';
      startButton.disabled = false;
      startButton.click();
    } catch (error) {
      startButton.disabled = false;
      if (status) status.textContent = `Could not open a new ChatGPT chat: ${error.message || error}`;
    } finally {
      delete startButton.dataset.newChatPrimed;
    }
  }, true);
}

ensureReadinessCenter();
ensureThreadPreferenceControl();
