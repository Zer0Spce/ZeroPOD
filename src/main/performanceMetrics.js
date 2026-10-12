const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 600;

class PerformanceMetrics {
  constructor() {
    this.cache = null;
    this.flushTimer = null;
    this.flushing = Promise.resolve();
  }

  getFile() {
    return path.join(app.getPath('userData'), 'performance-metrics.json');
  }

  load() {
    if (this.cache) return this.cache;
    try {
      const file = this.getFile();
      this.cache = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : { version: 1, entries: [] };
    } catch {
      this.cache = { version: 1, entries: [] };
    }
    if (!Array.isArray(this.cache.entries)) this.cache.entries = [];
    return this.cache;
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, 250);
    this.flushTimer.unref?.();
  }

  async flush() {
    const data = this.load();
    const file = this.getFile();
    const temp = `${file}.tmp`;
    const payload = JSON.stringify(data, null, 2);
    this.flushing = this.flushing.then(async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(temp, payload, 'utf8');
      await fs.promises.rename(temp, file).catch(async () => {
        await fs.promises.copyFile(temp, file);
        await fs.promises.rm(temp, { force: true });
      });
    });
    return this.flushing;
  }

  record(stage, elapsedMs, outcome = 'success', meta = {}) {
    const data = this.load();
    data.entries.push({
      at: new Date().toISOString(),
      stage: String(stage || 'unknown'),
      elapsedMs: Math.max(0, Math.round(Number(elapsedMs) || 0)),
      outcome: String(outcome || 'success'),
      meta: meta && typeof meta === 'object' ? meta : {}
    });
    if (data.entries.length > MAX_ENTRIES) data.entries = data.entries.slice(-MAX_ENTRIES);
    this.scheduleFlush();
  }

  percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
  }

  snapshot() {
    const data = this.load();
    const groups = new Map();
    for (const entry of data.entries) {
      if (!groups.has(entry.stage)) groups.set(entry.stage, []);
      groups.get(entry.stage).push(entry);
    }

    const stages = [...groups.entries()].map(([stage, entries]) => {
      const successful = entries.filter((entry) => entry.outcome === 'success');
      const timings = successful.map((entry) => Number(entry.elapsedMs) || 0);
      const last = entries[entries.length - 1];
      const avgMs = timings.length ? Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length) : 0;
      return {
        stage,
        samples: entries.length,
        successSamples: successful.length,
        successRate: entries.length ? Math.round((successful.length / entries.length) * 100) : 0,
        avgMs,
        p50Ms: Math.round(this.percentile(timings, 0.5)),
        p90Ms: Math.round(this.percentile(timings, 0.9)),
        lastMs: Number(last?.elapsedMs) || 0,
        lastOutcome: last?.outcome || null,
        lastAt: last?.at || null,
        lastMeta: last?.meta || {}
      };
    }).sort((a, b) => a.stage.localeCompare(b.stage));

    const workflowStageNames = new Set([
      'chatgpt-generation',
      'metadata-generation',
      'vectorizer',
      'export-png',
      'redbubble-prepare',
      'redbubble-publish'
    ]);
    const workflow = stages.filter((stage) => workflowStageNames.has(stage.stage));
    const estimatedWorkflowMs = workflow.reduce((sum, stage) => sum + stage.avgMs, 0);

    const browserEntries = data.entries.filter((entry) => entry.stage.startsWith('browser:'));
    const warmHits = browserEntries.filter((entry) => entry.meta?.warm === true && entry.outcome === 'success').length;
    const authCacheHits = data.entries.filter((entry) => entry.stage === 'auth-cache-hit' && entry.outcome === 'success').length;

    return {
      generatedAt: new Date().toISOString(),
      entries: data.entries.length,
      estimatedWorkflowMs,
      browser: {
        samples: browserEntries.length,
        warmHits,
        warmHitRate: browserEntries.length ? Math.round((warmHits / browserEntries.length) * 100) : 0,
        authCacheHits
      },
      stages
    };
  }
}

const performanceMetrics = new PerformanceMetrics();

module.exports = { PerformanceMetrics, performanceMetrics };
