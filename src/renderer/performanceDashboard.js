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

  function ensureStyles() {
    if (document.getElementById('zeroPodPerformanceStyles')) return;
    const style = document.createElement('style');
    style.id = 'zeroPodPerformanceStyles';
    style.textContent = `
      .performance-panel{margin-top:22px;padding:24px;overflow:hidden}
      .performance-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
      .performance-title-copy{min-width:0}
      .performance-title-copy h3{font-size:22px;line-height:1.2;margin:0 0 6px}
      .performance-title-copy p{margin:0;line-height:1.5}
      .performance-reuse{flex:0 0 auto;white-space:nowrap}
      .performance-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:22px}
      .performance-card{min-width:0;min-height:120px;padding:16px;border:1px solid var(--border);border-radius:13px;background:linear-gradient(180deg,var(--surface-2),var(--surface));display:flex;flex-direction:column;justify-content:space-between;gap:8px;box-shadow:var(--shadow-soft)}
      .performance-card-label{display:block;min-height:30px;font-size:11px;line-height:1.35;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted-2)}
      .performance-card-value{display:block;max-width:100%;font-size:28px;line-height:1;font-weight:800;letter-spacing:-.035em;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .performance-card-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:18px;font-size:11px;line-height:1.3;color:var(--muted)}
      .performance-card-meta span:last-child{text-align:right}
      .performance-card-pipeline .performance-card-value{color:var(--accent)}
      .performance-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:15px;border-top:1px solid var(--border-soft)}
      .performance-footer-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid var(--border);border-radius:999px;background:var(--surface-2);font-size:11px;color:var(--muted)}
      .performance-footer-chip strong{font-size:11px;color:var(--text)}
      @media(max-width:1180px){.performance-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:860px){.performance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.performance-header{display:grid}.performance-reuse{justify-self:start}.performance-grid{grid-template-columns:1fr}.performance-card{min-height:104px}}
    `;
    document.head.appendChild(style);
  }

  function metricCard(label, value, leftMeta, rightMeta, className = '') {
    return `
      <article class="performance-card ${className}">
        <span class="performance-card-label">${label}</span>
        <strong class="performance-card-value">${value}</strong>
        <div class="performance-card-meta"><span>${leftMeta}</span><span>${rightMeta}</span></div>
      </article>`;
  }

  function placePanel(panel, stats) {
    const uploadLimit = document.getElementById('redbubbleDailyLimit');
    if (uploadLimit) {
      if (uploadLimit.nextElementSibling !== panel) uploadLimit.insertAdjacentElement('afterend', panel);
      return;
    }
    if (stats.nextElementSibling !== panel) stats.insertAdjacentElement('afterend', panel);
  }

  function mount() {
    ensureStyles();
    const dashboard = document.getElementById('dashboard');
    const stats = document.getElementById('dashboardStats');
    if (!dashboard || !stats) return null;

    let panel = document.getElementById('performancePanel');
    if (panel) {
      placePanel(panel, stats);
      return panel;
    }

    panel = document.createElement('section');
    panel.id = 'performancePanel';
    panel.className = 'panel performance-panel';
    panel.innerHTML = `
      <div class="performance-header">
        <div class="performance-title-copy">
          <h3>Performance</h3>
          <p class="muted">Real timings from completed ZeroPOD stages on this PC.</p>
        </div>
        <span id="performanceWarmRate" class="queue-state performance-reuse">Warming up</span>
      </div>
      <div id="performanceStats" class="performance-grid"></div>
      <div id="performanceHint" class="performance-footer"></div>`;
    placePanel(panel, stats);
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
      cards.push(metricCard(
        'Measured Pipeline',
        snapshot.estimatedWorkflowMs > 0 ? formatMs(snapshot.estimatedWorkflowMs) : '—',
        'Average total',
        snapshot.estimatedWorkflowMs > 0 ? 'Completed stages' : 'No samples yet',
        'performance-card-pipeline'
      ));

      for (const [stage, label] of Object.entries(stageLabels)) {
        const metric = byStage[stage];
        cards.push(metricCard(
          label,
          metric ? formatMs(metric.avgMs) : '—',
          metric ? `${metric.samples} sample${metric.samples === 1 ? '' : 's'}` : 'No samples yet',
          metric ? `Last ${formatMs(metric.lastMs)}` : '—'
        ));
      }
      root.innerHTML = cards.join('');

      const warmRate = Number(snapshot.browser?.warmHitRate || 0);
      warm.textContent = snapshot.browser?.samples ? `${warmRate}% browser reuse` : 'Warming up';

      if (snapshot.entries) {
        hint.innerHTML = [
          `<span class="performance-footer-chip">Warm hits <strong>${snapshot.browser?.warmHits || 0}</strong></span>`,
          `<span class="performance-footer-chip">Auth cache hits <strong>${snapshot.browser?.authCacheHits || 0}</strong></span>`,
          `<span class="performance-footer-chip">Timing events <strong>${snapshot.entries}</strong></span>`
        ].join('');
      } else {
        hint.innerHTML = '<span class="performance-footer-chip">Timing data appears after stages complete.</span>';
      }
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
