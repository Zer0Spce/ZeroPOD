const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-performance-'));
  const originalLoad = Module._load;
  Module._load = function(request, ...args) {
    if (request === 'electron') return { app: { getPath: () => root } };
    return originalLoad.call(this, request, ...args);
  };

  try {
    const { PerformanceMetrics } = require('../src/main/performanceMetrics');
    const metrics = new PerformanceMetrics();
    metrics.record('chatgpt-generation', 1000, 'success', { projectId: 'one' });
    metrics.record('chatgpt-generation', 3000, 'success', { projectId: 'two' });
    metrics.record('metadata-generation', 500, 'success');
    metrics.record('browser:chatgpt', 50, 'success', { warm: true });
    metrics.record('auth-cache-hit', 0, 'success', { serviceId: 'chatgpt' });
    await metrics.flush();

    const snapshot = metrics.snapshot();
    const chatgpt = snapshot.stages.find((stage) => stage.stage === 'chatgpt-generation');
    assert.equal(chatgpt.avgMs, 2000);
    assert.equal(chatgpt.samples, 2);
    assert.equal(snapshot.estimatedWorkflowMs, 2500);
    assert.equal(snapshot.browser.warmHitRate, 100);
    assert.equal(snapshot.browser.authCacheHits, 1);
    assert(fs.existsSync(path.join(root, 'performance-metrics.json')));

    const queueSource = fs.readFileSync(path.join(__dirname, '../src/main/performanceQueuePatch.js'), 'utf8');
    assert.match(queueSource, /await wait\(500\)/);
    assert.match(queueSource, /await wait\(60\)/);
    assert.doesNotMatch(queueSource, /await wait\(2500\)/);
    assert.doesNotMatch(queueSource, /await wait\(1200\)/);

    const exportSource = fs.readFileSync(path.join(__dirname, '../src/main/exportPerformancePatch.js'), 'utf8');
    assert.match(exportSource, /PNG_COMPRESSION_LEVEL = 6/);
    assert.match(exportSource, /topClearancePxFor/);
    assert.match(exportSource, /4500/);
    assert.match(exportSource, /5400/);

    const fastFieldsPath = path.join(__dirname, '../src/main/redbubbleFastFieldsPatch.js');
    execFileSync(process.execPath, ['--check', fastFieldsPath], { stdio: 'pipe' });
    const fastFieldsSource = fs.readFileSync(fastFieldsPath, 'utf8');
    assert.match(fastFieldsSource, /fillListingFieldsFastFirst/);
    assert.match(fastFieldsSource, /waitUntil/);
    assert.match(fastFieldsSource, /supportAccepted/);
    assert.match(fastFieldsSource, /previousFillListingFields\.call/);
    assert.doesNotMatch(fastFieldsSource, /await wait\(110\)/);

    const bootstrap = fs.readFileSync(path.join(__dirname, '../src/main/bootstrap.js'), 'utf8');
    assert(bootstrap.indexOf("require('./redbubbleSkipDescriptionBetaPatch')") < bootstrap.indexOf("require('./redbubbleFastFieldsPatch')"));
    assert(bootstrap.indexOf("require('./redbubbleFastFieldsPatch')") < bootstrap.indexOf("require('./redbubbleReviewCapturePatch')"));
    assert(bootstrap.indexOf("require('./exportPerformancePatch')") < bootstrap.indexOf("require('./performanceOptimizationPatch')"));
    assert(bootstrap.indexOf("require('./performanceOptimizationPatch')") < bootstrap.indexOf("require('./main')"));

    const dashboardSource = fs.readFileSync(path.join(__dirname, '../src/renderer/performanceDashboard.js'), 'utf8');
    assert.match(dashboardSource, /performance-grid/);
    assert.match(dashboardSource, /performance-card-value/);
    assert.match(dashboardSource, /performance-footer-chip/);
    assert.doesNotMatch(dashboardSource, /id="performanceStats" class="stat-grid"/);

    const preload = fs.readFileSync(path.join(__dirname, '../src/main/preload.js'), 'utf8');
    assert.match(preload, /performance:snapshot/);

    console.log('Performance optimization smoke passed: persistent timings, warm-hit stats, fast queue cadence, optimized lossless PNG export, fast-first Redbubble fields with safe fallback, uniform performance UI, load order, and renderer API.');
  } finally {
    Module._load = originalLoad;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
