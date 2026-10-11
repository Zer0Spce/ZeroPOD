(() => {
  const REFERENCE_LIMIT = 30;
  let usage = { count: 0, blocked: false, detectedAt: null, clearedAt: null, message: null };
  let refreshTimer = null;

  function formatDate(value) {
    if (!value) return 'Not detected';
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
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
  }

  window.refreshRedbubbleUsage = refresh;
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
  if (!refreshTimer) refreshTimer = setInterval(refresh, 30000);
})();
