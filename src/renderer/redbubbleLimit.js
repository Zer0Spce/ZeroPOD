(() => {
  const LIMIT = 30;
  let usage = { count: 0, remaining: LIMIT, blocked: false, nextSlotAt: null };
  let refreshTimer = null;
  let clockTimer = null;

  function countdown(target) {
    if (!target) return 'READY';
    const remaining = Math.max(0, new Date(target).getTime() - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
        <div class="eyebrow">REDBUBBLE · ROLLING 24 HOURS</div>
        <div class="redbubble-limit-title-row"><h3>Daily upload tracker</h3><span id="redbubbleLimitBadge" class="redbubble-limit-badge">0 / ${LIMIT}</span></div>
        <p id="redbubbleLimitSummary" class="muted">Checking successful ZeroPOD publishes…</p>
        <div class="redbubble-limit-progress"><div id="redbubbleLimitProgressBar"></div></div>
        <div class="redbubble-limit-meta"><span><strong id="redbubbleRemaining">${LIMIT}</strong> locally tracked slots available</span><span id="redbubbleResetLabel">Rolling 24-hour window</span></div>
        <p class="redbubble-limit-note">ZeroPOD counts successful publishes it knows about, including archived projects. Manual uploads outside ZeroPOD are not counted. Redbubble does not expose a live account countdown here; if Redbubble shows its upload-limit warning, treat Redbubble as the source of truth and wait until that warning disappears.</p>
      </div>
      <div class="redbubble-limit-clock"><span>${LIMIT} max</span><strong id="redbubbleResetCountdown">READY</strong><small id="redbubbleResetCaption">next tracked slot</small></div>`;
    stats.insertAdjacentElement('afterend', card);
    return card;
  }

  function render() {
    const card = ensureCard();
    if (!card) return;
    const count = Number(usage.count || 0);
    const remaining = Math.max(0, Number(usage.remaining ?? LIMIT));
    const blocked = Boolean(usage.blocked);
    const nextSlotAt = usage.nextSlotAt || null;
    const percent = Math.min(100, (count / LIMIT) * 100);
    document.getElementById('redbubbleLimitBadge').textContent = `${count} / ${LIMIT}`;
    document.getElementById('redbubbleLimitBadge').classList.toggle('limit-reached', blocked);
    document.getElementById('redbubbleLimitProgressBar').style.width = `${percent}%`;
    document.getElementById('redbubbleRemaining').textContent = String(remaining);
    card.classList.toggle('limit-reached', blocked);

    if (!count) {
      document.getElementById('redbubbleLimitSummary').textContent = 'All 30 locally tracked upload slots are available.';
      document.getElementById('redbubbleResetLabel').textContent = 'Rolling 24-hour window';
      document.getElementById('redbubbleResetCountdown').textContent = 'READY';
      document.getElementById('redbubbleResetCaption').textContent = 'all tracked slots available';
    } else if (blocked) {
      document.getElementById('redbubbleLimitSummary').textContent = 'ZeroPOD’s local 30-upload safety limit is reached. Publishing is paused until a tracked slot opens.';
      document.getElementById('redbubbleResetLabel').textContent = nextSlotAt ? `Next tracked slot: ${new Date(nextSlotAt).toLocaleString()}` : 'Waiting for a tracked slot';
      document.getElementById('redbubbleResetCountdown').textContent = countdown(nextSlotAt);
      document.getElementById('redbubbleResetCaption').textContent = 'until next tracked slot';
    } else {
      document.getElementById('redbubbleLimitSummary').textContent = `${remaining} locally tracked upload slots remain in the last 24 hours.`;
      document.getElementById('redbubbleResetLabel').textContent = nextSlotAt ? `Oldest tracked upload ages out: ${new Date(nextSlotAt).toLocaleString()}` : 'Rolling 24-hour window';
      document.getElementById('redbubbleResetCountdown').textContent = countdown(nextSlotAt);
      document.getElementById('redbubbleResetCaption').textContent = 'oldest tracked slot refresh';
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
      if (summary) summary.textContent = `Upload tracker unavailable: ${error.message || error}`;
    }
  }

  function startTimers() {
    if (!refreshTimer) refreshTimer = setInterval(refresh, 30000);
    if (!clockTimer) clockTimer = setInterval(() => {
      if (usage.nextSlotAt && new Date(usage.nextSlotAt).getTime() <= Date.now()) refresh();
      else render();
    }, 1000);
  }

  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
  startTimers();
})();
