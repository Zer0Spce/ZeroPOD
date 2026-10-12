(() => {
  const api = window.zeroPOD?.performance;
  if (!api) return;

  const stageLabels = {
    'chatgpt-generation': 'ChatGPT Generation',
    'metadata-generation': 'POD WINNER Metadata',
    vectorizer: 'Vectorizer.ai',
    'export-png': 'PNG Export',
    'redbubble-prepare': 'Redbubble Prepare',
    'redbubble-publish': 'Redbubble Publish'
  };

  function formatMs(value) {
    const ms = Math.max(0, Number(value) || 0);
    if (!ms) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  function mount() {
    const dashboard = document.getElementById('dashboard');
    const stats = document.getElementById('dashboardStats');
    if (!dashboard || !stats) return null;

    let panel = document.getElementById('performancePanel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'performancePanel';
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="heading-row">
        <div><h3>Performance</h3><p class="muted">Real timings from completed ZeroPOD stages on this PC.</p></div>
        <span id="performanceWarmRate" class="queue-state">Warming up</span>
      </div>
      <div id="performanceStats" class="stat-grid"></div>
      <p id="performanceHint" class="muted" style="margin-bottom:0">Timing data appears after stages complete.</p>`;
    stats.insertAdjacentElement('afterend', panel);
    return panel;
  }

  async function refresh() {
    const panel = mount();
    if (!panel) return;
    try {
      const snapshot = await api.snapshot();
      const root = document.getElementById('performanceStats');
      const warm = document.getElementById('performanceWarmRate');
      const hint = document.getElementById('performanceHint');
      if (!root || !warm || !hint) return;

      const byStage = Object.fromEntries((snapshot.stages || []).map((stage) => [stage.stage, stage]));
      const cards = [];
      if (snapshot.estimatedWorkflowMs > 0) {
        cards.push(`<div class="stat"><span>Avg measured pipeline</span><strong>${formatMs(snapshot.estimatedWorkflowMs)}</strong></div>`);
      }
      for (const [stage, label] of Object.entries(stageLabels)) {
        const metric = byStage[stage];
        cards.push(`<div class="stat"><span>${label}</span><strong>${metric ? formatMs(metric.avgMs) : '—'}</strong><small>${metric ? `${metric.samples} sample${metric.samples === 1 ? '' : 's'} · last ${formatMs(metric.lastMs)}` : 'No samples yet'}</small></div>`);
      }
      root.innerHTML = cards.join('');

      const warmRate = Number(snapshot.browser?.warmHitRate || 0);
      warm.textContent = snapshot.browser?.samples
        ? `${warmRate}% browser reuse`
        : 'Warming up';
      hint.textContent = snapshot.entries
        ? `Browser warm hits: ${snapshot.browser?.warmHits || 0} · Auth cache hits: ${snapshot.browser?.authCacheHits || 0} · ${snapshot.entries} timing events retained.`
        : 'Timing data appears after stages complete.';
    } catch {
      // Telemetry must never affect the workflow UI.
    }
  }

  let timer = null;
  function start() {
    if (timer) return;
    refresh();
    timer = setInterval(() => {
      if (document.getElementById('dashboard')?.classList.contains('active-view')) refresh();
    }, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
