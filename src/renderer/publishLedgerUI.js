(() => {
  let timer = null;
  let cached = null;

  function apply(stats) {
    if (!stats) return;
    cached = stats;

    const tracked = document.getElementById('redbubbleTrackedCount');
    if (tracked) tracked.textContent = String(Number(stats.last24h || 0));

    const dashboardStats = document.getElementById('dashboardStats');
    if (dashboardStats) {
      for (const card of dashboardStats.querySelectorAll('.stat-card')) {
        const label = card.querySelector('span')?.textContent?.trim();
        if (label !== 'Published') continue;
        const value = card.querySelector('strong');
        if (value) value.textContent = String(Number(stats.totalPublished || 0));
      }
    }

    const automationSummary = document.getElementById('automationSummaryV2');
    if (automationSummary) {
      for (const item of automationSummary.querySelectorAll('span')) {
        if (/^Published\s+/i.test(item.textContent || '')) {
          item.textContent = `Published ${Number(stats.totalPublished || 0)}`;
          break;
        }
      }
    }
  }

  async function refresh() {
    if (!window.zeroPOD?.redbubble?.publishStats) return;
    try {
      const stats = await window.zeroPOD.redbubble.publishStats();
      apply(stats);
    } catch {}
  }

  window.refreshZeroPODPublishLedger = refresh;
  refresh();
  timer = setInterval(refresh, 1500);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('beforeunload', () => { if (timer) clearInterval(timer); });
})();
