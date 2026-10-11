(() => {
  const REFERENCE_LIMIT = 30;
  let usage = { count: 0, blocked: false, detectedAt: null, clearedAt: null, message: null };
  let refreshTimer = null;
  let automationTimer = null;

  function formatDate(value) {
    if (!value) return 'Not detected';
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
  }

  function ensureStyles() {
    if (document.getElementById('redbubbleLimitPauseStyles')) return;
    const style = document.createElement('style');
    style.id = 'redbubbleLimitPauseStyles';
    style.textContent = `
      .rb-limit-automation-notice{display:none;margin:12px 0 0;padding:13px 15px;border-radius:11px;border:1px solid rgba(239,68,68,.45);background:rgba(239,68,68,.09);color:var(--text);line-height:1.45}
      .rb-limit-automation-notice.visible{display:block}
      .rb-limit-automation-notice strong{display:block;color:#ff9898;margin-bottom:4px}
      .rb-limit-automation-notice span{color:var(--muted);font-size:12px}
    `;
    document.head.appendChild(style);
  }

  function ensureCard() {
    const stats = document.getElementById('dashboardStats');
    if (!stats) return null;
    let card = document.getElementById('redbubbleDailyLimit');
    if (card) return card;

    card = document.createElement('section');
    card.id = 'redbubbleDailyLimit';
    card.className = 'redbubble-limit-card';
    card.innerHTML = `
      <div class="redbubble-limit-copy">
        <div class="eyebrow">REDBUBBLE · LIVE LIMIT DETECTION</div>
        <div class="redbubble-limit-title-row"><h3>Upload limit status</h3><span id="redbubbleLimitBadge" class="redbubble-limit-badge">CHECKING</span></div>
        <p id="redbubbleLimitSummary" class="muted">Checking Redbubble limit status…</p>
        <div class="redbubble-limit-meta">
          <span><strong id="redbubbleTrackedCount">0</strong> successful ZeroPOD publishes in the last 24h</span>
          <span id="redbubbleDetectionLabel">No Redbubble limit page detected</span>
        </div>
        <p class="redbubble-limit-note">The local publish count is informational only. ZeroPOD does <strong>not</strong> stop publishing when this count reaches ${REFERENCE_LIMIT}. The upload limit is considered reached only when Redbubble itself shows its “exceeded your upload limit” page/message. The status clears after Redbubble accepts a new publish.</p>
      </div>
      <div class="redbubble-limit-clock"><span>REDBUBBLE</span><strong id="redbubbleLimitState">READY</strong><small>page-based detection</small></div>`;
    stats.insertAdjacentElement('afterend', card);
    return card;
  }

  function ensureAutomationNotice() {
    ensureStyles();
    const section = document.getElementById('automation');
    if (!section) return null;
    let notice = document.getElementById('redbubbleAutomationLimitNotice');
    if (notice) return notice;
    const warning = section.querySelector('.az-warning');
    if (!warning) return null;
    notice = document.createElement('div');
    notice.id = 'redbubbleAutomationLimitNotice';
    notice.className = 'rb-limit-automation-notice';
    warning.insertAdjacentElement('afterend', notice);
    return notice;
  }

  function render() {
    const card = ensureCard();
    if (!card) return;

    const count = Number(usage.localCount ?? usage.count ?? 0);
    const blocked = Boolean(usage.blocked);
    const badge = document.getElementById('redbubbleLimitBadge');
    const summary = document.getElementById('redbubbleLimitSummary');
    const state = document.getElementById('redbubbleLimitState');
    const detectionLabel = document.getElementById('redbubbleDetectionLabel');

    document.getElementById('redbubbleTrackedCount').textContent = String(count);
    card.classList.toggle('limit-reached', blocked);
    badge.classList.toggle('limit-reached', blocked);

    if (blocked) {
      badge.textContent = 'LIMIT DETECTED';
      state.textContent = 'BLOCKED';
      summary.textContent = usage.message || 'Redbubble itself reported that the upload limit has been reached.';
      detectionLabel.textContent = `Detected from Redbubble: ${formatDate(usage.detectedAt)}`;
    } else {
      badge.textContent = 'READY';
      state.textContent = 'READY';
      summary.textContent = 'No Redbubble upload-limit warning has been detected. ZeroPOD will keep attempting normal publishes regardless of the local count.';
      detectionLabel.textContent = usage.clearedAt
        ? `Last detected limit cleared after a successful publish: ${formatDate(usage.clearedAt)}`
        : 'No Redbubble limit page detected';
    }
  }

  async function refreshAutomationNotice() {
    const notice = ensureAutomationNotice();
    if (!notice || !window.zeroPOD?.automation?.list) return;
    try {
      const snapshot = await window.zeroPOD.automation.list();
      const recovery = snapshot.recovery || {};
      const active = snapshot.state === 'paused' && recovery.type === 'redbubble-upload-limit';
      notice.classList.toggle('visible', active);
      if (!active) {
        notice.innerHTML = '';
        return;
      }
      const recovered = Number(recovery.recoveredRows || 0);
      notice.innerHTML = `<strong>⏸ Automation paused — Redbubble upload limit reached</strong><span>${recovery.message || 'Redbubble reported that uploads are currently blocked.'} All unfinished jobs were preserved at their current stage.${recovered ? ` ${recovered} earlier Redbubble failure${recovered === 1 ? '' : 's'} were returned to the queue because they occurred while this limit page was active.` : ''} Press Start Automation later to test Redbubble again; ZeroPOD will retry from the Redbubble step.</span>`;
    } catch {}
  }

  async function refresh() {
    try {
      if (!window.zeroPOD?.redbubble?.dailyUsage) return;
      usage = await window.zeroPOD.redbubble.dailyUsage();
      render();
    } catch (error) {
      ensureCard();
      const summary = document.getElementById('redbubbleLimitSummary');
      if (summary) summary.textContent = `Redbubble limit status unavailable: ${error.message || error}`;
    }
    await refreshAutomationNotice();
  }

  window.refreshRedbubbleUsage = refresh;
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
  if (!refreshTimer) refreshTimer = setInterval(refresh, 30000);
  if (!automationTimer) automationTimer = setInterval(refreshAutomationNotice, 1500);
})();
