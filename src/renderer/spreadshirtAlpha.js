(() => {
  if (window.__zeroPODSpreadshirtAlphaInstalled) return;
  window.__zeroPODSpreadshirtAlphaInstalled = true;
  const api = window.zeroPOD?.spreadshirt;
  if (!api) return;

  const ACTIVE_KEY = 'zeropod.spreadshirt.alpha.activeProject';
  const NEW_CHAT_KEY = 'zeropod.spreadshirt.alpha.newChat';
  let activeProjectId = localStorage.getItem(ACTIVE_KEY) || null;
  let running = false;
  let lastGate = null;
  let workflowStartedAt = null;
  let timerHandle = null;

  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const fileUrl = (value) => `file:///${String(value || '').replace(/\\/g, '/')}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const formatBytes = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function updateTimer() {
    const root = byId('ssTimer');
    if (root) root.textContent = workflowStartedAt ? formatElapsed(Date.now() - workflowStartedAt) : '00:00';
  }

  function startTimer() {
    workflowStartedAt ||= Date.now();
    if (timerHandle) clearInterval(timerHandle);
    updateTimer();
    timerHandle = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    updateTimer();
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function installStyles() {
    if (byId('spreadshirtAlphaStyles')) return;
    const style = document.createElement('style');
    style.id = 'spreadshirtAlphaStyles';
    style.textContent = `
      .ss-alpha-mark{font-weight:900}.ss-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:18px;align-items:start}.ss-panel{background:var(--surface,#171b21);border:1px solid var(--border,#2a313c);border-radius:14px;padding:16px;margin-bottom:16px}.ss-stage{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0 16px}.ss-stage span{padding:7px 10px;border:1px solid var(--border,#303744);border-radius:999px;font-size:11px;color:var(--muted,#98a3b2)}.ss-stage .current{border-color:var(--accent,#6875ff);color:var(--text,#fff)}.ss-stage .done{border-color:#355b48;color:#85ddb0}.ss-review{display:none}.ss-review.visible{display:block}.ss-preview{width:100%;max-height:560px;object-fit:contain;background:#090c0f;border:1px solid var(--border,#2a313c);border-radius:12px}.ss-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ss-small{font-size:11px;color:var(--muted,#98a3b2);line-height:1.45}.ss-status{padding:10px 12px;border-radius:9px;background:var(--surface-2,#101419);margin-top:10px;white-space:pre-wrap}.ss-gates{display:grid;gap:7px}.ss-gate{display:flex;justify-content:space-between;gap:12px;padding:9px 10px;border-radius:9px;background:var(--surface-2,#101419)}.ss-gate.ok b{color:#85ddb0}.ss-gate.bad b{color:#ff9ba5}.ss-gate.warn b{color:#e9d27a}.ss-usage{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ss-usage-card{padding:12px;border:1px solid var(--border,#2a313c);border-radius:11px}.ss-usage-card strong{display:block;font-size:22px}.ss-flying-button{font-weight:700}.ss-log{height:260px;overflow:auto;background:#090c0f;border:1px solid var(--border,#2a313c);border-radius:10px;padding:10px;font-family:Consolas,monospace;font-size:11px;line-height:1.5}.ss-log-line{margin-bottom:4px}.ss-log-line.error{color:#ff9ba5}.ss-log-line.ok{color:#85ddb0}.ss-log-line.warn{color:#e9d27a}.ss-badge{display:inline-flex;padding:3px 7px;border-radius:999px;background:#4a3d16;color:#f1d462;font-size:10px;font-weight:900;letter-spacing:.04em}.ss-final-grid{display:grid;grid-template-columns:minmax(260px,.85fr) minmax(300px,1.15fr);gap:14px}.ss-meta{display:grid;gap:10px}.ss-meta-row{padding:10px 12px;background:var(--surface-2,#101419);border-radius:9px}.ss-meta-row b{display:block;font-size:11px;color:var(--muted,#98a3b2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}.ss-header-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ss-timer{font-family:Consolas,monospace;font-variant-numeric:tabular-nums;padding:8px 11px;border:1px solid var(--border,#394251);border-radius:9px;background:var(--surface-2,#101419);min-width:72px;text-align:center}.ss-option{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:12px;border:1px solid var(--border,#394251);border-radius:11px;background:var(--surface-2,#101419);margin-top:12px}.ss-published{padding:16px;border:1px solid #355b48;border-radius:12px;background:rgba(53,91,72,.12)}@media(max-width:1050px){.ss-grid,.ss-final-grid,.ss-usage{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function build() {
    if (byId('spreadshirtAlpha')) return;
    installStyles();
    const workflowNav = document.querySelector('.nav[data-view="create"]');
    const main = document.querySelector('main.content');
    if (!workflowNav || !main) return;

    const nav = document.createElement('button');
    nav.className = 'nav';
    nav.dataset.view = 'spreadshirtAlpha';
    nav.innerHTML = 'Spreadshirt <strong class="ss-alpha-mark">[ALPHA]</strong>';
    workflowNav.insertAdjacentElement('afterend', nav);

    const section = document.createElement('section');
    section.id = 'spreadshirtAlpha';
    section.className = 'view';
    section.innerHTML = `
      <div class="eyebrow">ONE-CLICK SPREADSHIRT PIPELINE</div>
      <div class="heading-row"><div><h2>Spreadshirt <strong>[ALPHA]</strong></h2><p class="muted">Start once → image check → automatic metadata/vector/export/gates/upload → final review → publish.</p></div><div class="ss-header-right"><div id="ssTimer" class="ss-timer">00:00</div><div id="ssProjectBadge" class="queue-state">No active project</div></div></div>
      <div class="ss-stage" id="ssStages"><span data-stage="generate">Generate</span><span data-stage="review">Image Check</span><span data-stage="metadata">Metadata</span><span data-stage="vector">Vectorize</span><span data-stage="export">4500×5400 Export</span><span data-stage="gates">Gate Checks</span><span data-stage="upload">Spreadshirt Upload</span><span data-stage="final">Final Review</span><span data-stage="publish">Publish</span></div>
      <div class="ss-grid">
        <div>
          <div class="ss-panel">
            <div class="heading-row"><div><h3>Start Spreadshirt Workflow</h3><p class="muted">Manual reference wins. If blank, ZeroPOD fetches the reference from the Amazon/source URL.</p></div><span class="ss-badge">ALPHA</span></div>
            <div class="form-grid">
              <label>Reference image<div class="file-row"><input id="ssReferencePath" readonly placeholder="Choose an image or use source URL" /><button id="ssChooseReference">Browse</button></div></label>
              <label>Amazon / source URL<input id="ssSourceUrl" type="url" placeholder="https://..." /></label>
              <label>Optional generation notes<textarea id="ssNotes" placeholder="Optional notes for ChatGPT…"></textarea></label>
            </div>
            <label class="ss-option"><input id="ssNewChat" type="checkbox" ${localStorage.getItem(NEW_CHAT_KEY) === '1' ? 'checked' : ''} /><span><strong>New Chat</strong><span class="ss-small">Checked: start this design in one fresh ChatGPT conversation. Unchecked: reuse the last working thread.</span></span></label>
            <div class="ss-actions" style="margin-top:12px"><button id="ssStart" class="primary">Start Spreadshirt Workflow</button><button id="ssResume">Resume Active Project</button></div>
            <div id="ssStatus" class="ss-status muted">Ready.</div>
          </div>

          <div id="ssImageReview" class="ss-panel ss-review">
            <h3>Check 1 · Generated Image</h3><p class="muted">This is the design-quality gate. Pass continues the rest of the Spreadshirt workflow automatically.</p>
            <img id="ssGeneratedImage" class="ss-preview" alt="Spreadshirt generated design" />
            <label style="margin-top:12px">Regeneration notes<textarea id="ssRegenerationNotes" placeholder="What should change?"></textarea></label>
            <div class="ss-actions" style="margin-top:10px"><button id="ssRegenerate" class="danger">Fail · Regenerate</button><button id="ssPassImage" class="primary">Pass · Continue Workflow</button></div>
          </div>

          <div id="ssFinalReview" class="ss-panel ss-review">
            <h3>Check 2 · Spreadshirt Final Review</h3>
            <p class="muted">ZeroPOD has generated metadata, vectorized, exported the regular 4500×5400 PNG, run Gate Checks and prepared Spreadshirt. Review once, then publish.</p>
            <div class="ss-final-grid">
              <div id="ssReviewPreview"><div class="ss-small">Waiting for Spreadshirt review preview…</div></div>
              <div class="ss-meta">
                <div class="ss-meta-row"><b>Design name</b><span id="ssFinalTitle">—</span></div>
                <div class="ss-meta-row"><b>Description</b><span id="ssFinalDescription">—</span></div>
                <div class="ss-meta-row"><b>Keywords</b><span id="ssFinalKeywords">—</span></div>
                <div class="ss-meta-row"><b>Artwork</b><span id="ssFinalArtwork">—</span></div>
                <div class="ss-meta-row"><b>Gate Checks</b><span id="ssFinalGateSummary">—</span></div>
              </div>
            </div>
            <div class="ss-actions" style="margin-top:12px"><button id="ssOpenFinal">Open Spreadshirt Review</button><button id="ssFinalFail" class="danger">Fail · Open for Edit</button><button id="ssPublish" class="primary">Pass · Publish</button></div>
            <div id="ssPublishStatus" class="ss-status muted">Waiting for preparation.</div>
          </div>

          <div id="ssPublished" class="ss-panel ss-review">
            <div class="ss-published"><h3>Published ✓</h3><div id="ssPublishedText" class="muted"></div><div class="ss-meta-row" style="margin-top:12px"><b>Total workflow time</b><span id="ssPublishedElapsed">—</span></div></div>
          </div>
        </div>

        <div>
          <div class="ss-panel"><h3>Upload Limits</h3><div class="ss-usage"><div class="ss-usage-card"><span class="ss-small">Daily</span><strong id="ssDailyUsage">0 / 10</strong><span id="ssDailyRemaining" class="ss-small">10 remaining</span></div><div class="ss-usage-card"><span class="ss-small">Account</span><strong id="ssAccountUsage">0 / 50</strong><span id="ssAccountRemaining" class="ss-small">50 remaining</span></div></div><label style="margin-top:12px">Existing published designs on this account<input id="ssAccountBaseline" type="number" min="0" step="1" value="0" /></label><button id="ssSaveBaseline">Save Existing Count</button><p class="ss-small">ZeroPOD counts verified publishes it performs. Set the existing count once so the 50-account gate includes older designs.</p></div>
          <div class="ss-panel"><div class="heading-row"><div><h3>Spreadshirt Session</h3><p class="ss-small">Login/CAPTCHA/2FA remains manual. Normal runs reuse the verified session automatically.</p></div><span id="ssSessionState" class="queue-state">Not tested</span></div><div class="ss-actions"><button id="ssLogin">Open Login Browser</button><button id="ssTest">Test Session</button><button id="ssOpen">Open Spreadshirt</button></div></div>
          <div class="ss-panel"><h3>Gate Checks</h3><div id="ssGateResults" class="ss-gates"><div class="ss-gate warn"><span>Gate status</span><b>Runs automatically</b></div></div></div>
          <div class="ss-panel"><h3>Artwork</h3><div id="ssArtworkInfo" class="ss-small">No Spreadshirt artwork prepared yet.</div><div id="ssArtworkPreview" style="margin-top:10px"></div></div>
          <div class="ss-panel"><div class="heading-row"><h3>Activity</h3><button id="ssClearLog">Clear</button></div><div id="ssLog" class="ss-log"></div></div>
        </div>
      </div>`;
    main.appendChild(section);

    nav.addEventListener('click', () => {
      document.querySelectorAll('.nav').forEach((el) => el.classList.toggle('active', el === nav));
      document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active-view', el === section));
      refresh().catch(showError);
    });
    document.addEventListener('click', (event) => {
      const other = event.target.closest?.('.nav[data-view]');
      if (other && other !== nav) { section.classList.remove('active-view'); nav.classList.remove('active'); }
    }, true);

    wire();
    installFlyingButtons();
    hydrate().catch(() => {});
    setInterval(() => {
      if (section.classList.contains('active-view')) refresh().catch(() => {});
    }, 1800);
  }

  function log(message, kind = '') {
    const root = byId('ssLog');
    if (!root) return;
    const line = document.createElement('div');
    line.className = `ss-log-line ${kind}`;
    line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    root.appendChild(line);
    while (root.children.length > 220) root.removeChild(root.firstChild);
    root.scrollTop = root.scrollHeight;
  }

  function status(message, kind = '') {
    const root = byId('ssStatus');
    if (!root) return;
    root.textContent = message;
    root.className = `ss-status ${kind === 'error' ? 'validation-errors' : kind === 'ok' ? 'qc-good' : 'muted'}`;
  }

  function showError(error) {
    status(error?.message || String(error), 'error');
    log(error?.message || String(error), 'error');
  }

  function setActiveProject(projectId) {
    activeProjectId = projectId || null;
    if (activeProjectId) localStorage.setItem(ACTIVE_KEY, activeProjectId);
    else localStorage.removeItem(ACTIVE_KEY);
  }

  async function project() {
    if (!activeProjectId) return null;
    try { return await window.zeroPOD.projects.get(activeProjectId); }
    catch { return null; }
  }

  async function waitForProjectStatus(statuses, timeoutMs = 240000) {
    const wanted = new Set(statuses);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const p = await project();
      if (!p) return null;
      if (wanted.has(p.status)) return p;
      await sleep(1000);
    }
    return project();
  }

  function renderStages(name) {
    const order = ['generate','review','metadata','vector','export','gates','upload','final','publish'];
    const current = order.indexOf(name);
    document.querySelectorAll('#ssStages [data-stage]').forEach((node) => {
      const index = order.indexOf(node.dataset.stage);
      node.classList.toggle('done', current >= 0 && index < current);
      node.classList.toggle('current', index === current);
    });
  }

  async function refreshUsage() {
    const [usage, settings] = await Promise.all([api.usage(), api.settings()]);
    byId('ssDailyUsage').textContent = `${usage.dailyUsed} / ${usage.dailyLimit}`;
    byId('ssDailyRemaining').textContent = `${usage.dailyRemaining} remaining`;
    byId('ssAccountUsage').textContent = `${usage.accountTotal} / ${usage.accountLimit}`;
    byId('ssAccountRemaining').textContent = `${usage.accountRemaining} remaining`;
    if (document.activeElement !== byId('ssAccountBaseline')) byId('ssAccountBaseline').value = settings.accountBaseline || 0;
    return usage;
  }

  function renderGate(gate) {
    const root = byId('ssGateResults');
    if (!root) return;
    if (!gate) {
      root.innerHTML = '<div class="ss-gate warn"><span>Gate status</span><b>Runs automatically</b></div>';
      return;
    }
    const rows = [
      ['Artwork', gate.artwork ? `${gate.artwork.width}×${gate.artwork.height} · ${formatBytes(gate.artwork.bytes)}` : 'Missing', Boolean(gate.artwork)],
      ['Metadata', gate.metadata?.title ? `${gate.metadata.title} · ${gate.metadata.keywords.length} keywords` : 'Missing', Boolean(gate.metadata?.title)],
      ['Spreadshirt Session', gate.session?.authStatus || 'not configured', gate.session?.authStatus === 'verified'],
      ['Daily Limit', `${gate.usage.dailyUsed}/${gate.usage.dailyLimit}`, !gate.usage.dailyBlocked],
      ['Account Limit', `${gate.usage.accountTotal}/${gate.usage.accountLimit}`, !gate.usage.accountBlocked]
    ];
    root.innerHTML = rows.map(([label, value, ok]) => `<div class="ss-gate ${ok ? 'ok' : 'bad'}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('') +
      (gate.warnings?.length ? `<div class="ss-gate warn"><span>Warnings</span><b>${esc(gate.warnings.join(' · '))}</b></div>` : '') +
      (gate.errors?.length ? `<div class="ss-gate bad"><span>Blocking</span><b>${esc(gate.errors.join(' · '))}</b></div>` : '');
  }

  function stageFor(p) {
    if (!p) return 'generate';
    if (p.spreadshirt?.publishedAt) return 'publish';
    if (p.spreadshirt?.preparedAt) return 'final';
    if (p.status === 'awaiting-review') return 'review';
    if (!p.metadata || ['approved-image','metadata-generating','metadata-recovery-needed'].includes(p.status)) return 'metadata';
    if (!p.vectorPath || ['metadata-ready','vectorizing','vectorizer-recovery-needed','vectorizer-manual-download'].includes(p.status)) return 'vector';
    if (!p.finalPngPath || !p.spreadshirt?.pngPath || p.status === 'vector-ready') return 'export';
    if (!lastGate?.ok) return 'gates';
    return 'upload';
  }

  async function refresh() {
    const usage = await refreshUsage();
    const p = await project();
    byId('ssProjectBadge').textContent = p?.id || 'No active project';
    byId('ssResume').disabled = running || !p;
    byId('ssStart').disabled = running;
    byId('ssPassImage').disabled = running || p?.status !== 'awaiting-review';
    byId('ssRegenerate').disabled = running || p?.status !== 'awaiting-review';
    byId('ssPublish').disabled = running || !p?.spreadshirt?.preparedAt || Boolean(p?.spreadshirt?.publishedAt) || usage.dailyBlocked || usage.accountBlocked;

    if (!p) {
      renderStages('generate');
      return;
    }

    const spread = p.spreadshirt || {};
    byId('ssImageReview').classList.toggle('visible', p.status === 'awaiting-review');
    byId('ssFinalReview').classList.toggle('visible', Boolean(spread.preparedAt) && !spread.publishedAt);
    byId('ssPublished').classList.toggle('visible', Boolean(spread.publishedAt));
    if (p.status === 'awaiting-review' && p.generatedImagePath) byId('ssGeneratedImage').src = fileUrl(p.generatedImagePath);

    if (spread.pngPath || p.finalPngPath) {
      const file = spread.pngPath || p.finalPngPath;
      const info = spread.export || {};
      byId('ssArtworkInfo').textContent = `${info.width || 4500}×${info.height || 5400}${info.bytes ? ` · ${formatBytes(info.bytes)}` : ''} · regular ZeroPOD export`;
      byId('ssArtworkPreview').innerHTML = `<img class="ss-preview" src="${esc(fileUrl(file))}" alt="Spreadshirt export" />`;
    }

    const statuses = await window.zeroPOD.connections.list().catch(() => ({}));
    byId('ssSessionState').textContent = statuses.spreadshirt?.authStatus === 'verified' ? 'Verified' : (statuses.spreadshirt?.authStatus || 'Not tested');
    renderStages(stageFor(p));
    if (!running && !spread.publishedAt && !spread.preparedAt && p.status !== 'awaiting-review') status(`Project ${p.id} · ${p.status}${spread.status ? ` · Spreadshirt ${spread.status}` : ''}`);
  }

  async function renderImageGate(p = null) {
    p ||= await project();
    if (!p) return;
    renderStages('review');
    byId('ssImageReview').classList.add('visible');
    byId('ssFinalReview').classList.remove('visible');
    byId('ssPublished').classList.remove('visible');
    if (p.generatedImagePath) byId('ssGeneratedImage').src = fileUrl(p.generatedImagePath);
    byId('ssRegenerationNotes').value = p.review?.notes || '';
    status('Generated image is ready for Check 1.');
    log('Generated image ready for review.', 'ok');
  }

  async function renderFinalGate(p = null) {
    p ||= await project();
    if (!p) return;
    const spread = p.spreadshirt || {};
    const meta = spread.metadata || {};
    renderStages('final');
    byId('ssImageReview').classList.remove('visible');
    byId('ssFinalReview').classList.add('visible');
    byId('ssPublished').classList.remove('visible');
    byId('ssFinalTitle').textContent = meta.title || '—';
    byId('ssFinalDescription').textContent = meta.description || '—';
    byId('ssFinalKeywords').textContent = (meta.keywords || []).join(', ') || '—';
    const info = spread.export || {};
    byId('ssFinalArtwork').textContent = spread.pngPath ? `${info.width || 4500}×${info.height || 5400} transparent PNG` : '—';
    byId('ssFinalGateSummary').textContent = lastGate?.ok ? `Passed · Daily ${lastGate.usage.dailyUsed}/${lastGate.usage.dailyLimit} · Account ${lastGate.usage.accountTotal}/${lastGate.usage.accountLimit}` : 'Passed before preparation';
    const preview = byId('ssReviewPreview');
    if (spread.reviewScreenshotPath) preview.innerHTML = `<img class="ss-preview" src="${esc(fileUrl(spread.reviewScreenshotPath))}" alt="Spreadshirt final review" />`;
    else if (spread.pngPath) preview.innerHTML = `<img class="ss-preview" src="${esc(fileUrl(spread.pngPath))}" alt="Spreadshirt artwork" />`;
    else preview.innerHTML = '<div class="ss-small">Preview unavailable. Open Spreadshirt Review to inspect the live editor.</div>';
    byId('ssPublishStatus').textContent = 'Prepared. Review the live Spreadshirt editor once, then Pass · Publish.';
    status('Spreadshirt is prepared. Waiting for Check 2.', 'ok');
    log('Spreadshirt preparation complete. Waiting for final approval.', 'ok');
  }

  async function renderPublished(p = null) {
    p ||= await project();
    if (!p) return;
    renderStages('publish');
    byId('ssImageReview').classList.remove('visible');
    byId('ssFinalReview').classList.remove('visible');
    byId('ssPublished').classList.add('visible');
    const spread = p.spreadshirt || {};
    byId('ssPublishedText').textContent = `Spreadshirt publish verified${spread.publishedUrl ? ` · ${spread.publishedUrl}` : ''}`;
    byId('ssPublishedElapsed').textContent = workflowStartedAt ? formatElapsed(Date.now() - workflowStartedAt) : '—';
    stopTimer();
    status('Spreadshirt workflow complete · Published ✓', 'ok');
    log('Spreadshirt publish verified. Workflow complete.', 'ok');
  }

  async function ensureSpreadshirtSession() {
    const statuses = await window.zeroPOD.connections.list().catch(() => ({}));
    if (statuses.spreadshirt?.authStatus === 'verified') return true;
    log('Testing Spreadshirt session automatically…');
    const result = await api.test();
    if (result.status !== 'verified') throw new Error('Spreadshirt login is required. Click Open Login Browser, finish login/CAPTCHA/2FA, then press Resume Active Project.');
    log('Spreadshirt session verified.', 'ok');
    return true;
  }

  async function runPostApprovalPipeline() {
    if (!activeProjectId || running) return;
    running = true;
    byId('ssImageReview').classList.remove('visible');
    try {
      let p = await project();
      if (!p) throw new Error('Spreadshirt project is unavailable.');

      if (!p.metadata || ['approved-image','metadata-recovery-needed'].includes(p.status)) {
        renderStages('metadata');
        status('Generating POD WINNER metadata automatically…');
        log('Generating POD WINNER metadata…');
        await window.zeroPOD.metadata.generate(activeProjectId);
        p = await project();
      }

      if (!p?.vectorPath || ['metadata-ready','vectorizer-recovery-needed'].includes(p?.status)) {
        renderStages('vector');
        status('Vectorizing approved design automatically…');
        log('Vectorizing approved artwork…');
        await window.zeroPOD.vectorizer.start(activeProjectId);
        p = await project();
      }

      if (!p?.finalPngPath || !p?.spreadshirt?.pngPath || p?.status === 'vector-ready') {
        renderStages('export');
        status('Exporting the regular transparent 4500×5400 PNG…');
        log('Exporting regular ZeroPOD 4500×5400 PNG…');
        await api.exportPng(activeProjectId);
        p = await project();
      }

      if (!p?.spreadshirt?.metadata) {
        renderStages('metadata');
        status('Building Spreadshirt listing metadata automatically…');
        log('Building Spreadshirt design name, description and keywords…');
        await api.deriveMetadata(activeProjectId);
        p = await project();
      }

      await ensureSpreadshirtSession();
      renderStages('gates');
      status('Running Spreadshirt Gate Checks automatically…');
      log('Running artwork, metadata, session and upload-limit Gate Checks…');
      lastGate = await api.check(activeProjectId);
      renderGate(lastGate);
      if (!lastGate.ok) throw new Error(lastGate.errors.join(' '));
      log('All Spreadshirt Gate Checks passed.', 'ok');

      p = await project();
      if (!p?.spreadshirt?.preparedAt) {
        renderStages('upload');
        status('Uploading artwork and preparing Spreadshirt automatically…');
        log('Uploading artwork and navigating to Spreadshirt listing metadata…');
        const prepared = await api.prepare(activeProjectId);
        log(prepared.message || 'Spreadshirt listing prepared.', 'ok');
      }

      await renderFinalGate(await project());
    } catch (error) {
      stopTimer();
      status(`Spreadshirt workflow needs attention: ${error.message || error}`, 'error');
      log(`ERROR: ${error.message || error}`, 'error');
    } finally {
      running = false;
      await refresh().catch(() => {});
    }
  }

  async function startWorkflow() {
    if (running) return;
    let referencePath = byId('ssReferencePath').value.trim();
    const sourceUrl = byId('ssSourceUrl').value.trim();
    const notes = byId('ssNotes').value.trim();
    if (!referencePath && !sourceUrl) return status('Choose a reference image or enter an Amazon/source URL.', 'error');

    running = true;
    startTimer();
    byId('ssImageReview').classList.remove('visible');
    byId('ssFinalReview').classList.remove('visible');
    byId('ssPublished').classList.remove('visible');
    renderStages('generate');
    try {
      if (!referencePath) {
        status('Fetching reference image from source URL…');
        log('No reference attached. Fetching the source image automatically…');
        const resolved = await window.zeroPOD.sourceImage.resolve(sourceUrl);
        referencePath = resolved.path;
        byId('ssReferencePath').value = referencePath;
        log(`Reference fetched from ${resolved.sourceType || 'source URL'}.`, 'ok');
      }
      const newChat = byId('ssNewChat').checked;
      localStorage.setItem(NEW_CHAT_KEY, newChat ? '1' : '0');
      status('Generating design in ChatGPT…');
      log(`Starting Spreadshirt workflow${newChat ? ' · NEW CHAT' : ''}.`);
      const result = await window.zeroPOD.generation.start({ referencePath, sourceUrl, reviewNotes: notes, newChat });
      setActiveProject(result.projectId);
      await api.markProject({ projectId: result.projectId, source: { source: 'spreadshirt-alpha' } });
      let p = await project();
      if (p?.status !== 'awaiting-review') p = await waitForProjectStatus(['awaiting-review','chatgpt-recovery-needed','chatgpt-policy-rejected']);
      if (!p || p.status !== 'awaiting-review') throw new Error(p?.chatgptError?.message || 'Generated image did not reach the review state.');
      await renderImageGate(p);
    } catch (error) {
      stopTimer();
      showError(error);
    } finally {
      running = false;
      await refresh().catch(() => {});
    }
  }

  async function approveImageAndContinue() {
    if (!activeProjectId || running) return;
    running = true;
    try {
      status('Approving generated image…');
      log('Image passed. Continuing the Spreadshirt pipeline automatically…', 'ok');
      await window.zeroPOD.review.pass({ projectId: activeProjectId });
    } catch (error) {
      showError(error);
      running = false;
      return;
    }
    running = false;
    await runPostApprovalPipeline();
  }

  async function regenerateImage() {
    if (!activeProjectId || running) return;
    running = true;
    try {
      renderStages('generate');
      const notes = byId('ssRegenerationNotes').value.trim();
      status('Regenerating image in ChatGPT…');
      log(`Image failed. Regenerating${notes ? ` with notes: ${notes}` : ''}…`, 'warn');
      await window.zeroPOD.review.reject({ projectId: activeProjectId, notes });
      let p = await project();
      if (p?.status !== 'awaiting-review') p = await waitForProjectStatus(['awaiting-review','chatgpt-recovery-needed']);
      if (!p || p.status !== 'awaiting-review') throw new Error(p?.chatgptError?.message || 'Regeneration did not return a reviewable image.');
      await renderImageGate(p);
    } catch (error) {
      showError(error);
    } finally {
      running = false;
      await refresh().catch(() => {});
    }
  }

  async function publishActive() {
    if (!activeProjectId || running) return;
    running = true;
    try {
      renderStages('publish');
      status('Publishing to Spreadshirt…');
      log('Publishing prepared Spreadshirt listing…');
      const result = await api.publish(activeProjectId);
      lastGate = await api.check(activeProjectId).catch(() => lastGate);
      renderGate(lastGate);
      await renderPublished(result?.project || await project());
    } catch (error) {
      stopTimer();
      showError(error);
    } finally {
      running = false;
      await refresh().catch(() => {});
    }
  }

  async function resumeWorkflow() {
    if (!activeProjectId) {
      const projects = await window.zeroPOD.projects.list();
      const candidate = projects.find((item) => item.spreadshirt?.alpha && !item.spreadshirt?.publishedAt);
      if (candidate) setActiveProject(candidate.id);
    }
    const p = await project();
    if (!p) return status('No active Spreadshirt project to resume.', 'error');
    startTimer();
    log(`Resuming ${p.id} from ${p.status}.`);
    if (p.spreadshirt?.publishedAt) return renderPublished(p);
    if (p.spreadshirt?.preparedAt) return renderFinalGate(p);
    if (p.status === 'awaiting-review') return renderImageGate(p);
    return runPostApprovalPipeline();
  }

  function wire() {
    byId('ssChooseReference').addEventListener('click', async () => {
      const file = await window.zeroPOD.files.chooseReference();
      if (file) byId('ssReferencePath').value = file;
    });
    byId('ssNewChat').addEventListener('change', () => localStorage.setItem(NEW_CHAT_KEY, byId('ssNewChat').checked ? '1' : '0'));
    byId('ssStart').addEventListener('click', startWorkflow);
    byId('ssResume').addEventListener('click', resumeWorkflow);
    byId('ssRegenerate').addEventListener('click', regenerateImage);
    byId('ssPassImage').addEventListener('click', approveImageAndContinue);
    byId('ssPublish').addEventListener('click', publishActive);
    byId('ssOpenFinal').addEventListener('click', () => api.open().catch(showError));
    byId('ssFinalFail').addEventListener('click', async () => {
      log('Final review failed. Opening Spreadshirt so the listing can be edited without creating a duplicate upload.', 'warn');
      await api.open().catch(showError);
    });
    byId('ssLogin').addEventListener('click', () => api.login().catch(showError));
    byId('ssTest').addEventListener('click', async () => {
      try {
        const result = await api.test();
        log(`Spreadshirt session: ${result.status}.`, result.status === 'verified' ? 'ok' : 'warn');
        await refresh();
      } catch (error) { showError(error); }
    });
    byId('ssOpen').addEventListener('click', () => api.open().catch(showError));
    byId('ssSaveBaseline').addEventListener('click', async () => {
      try {
        await api.updateSettings({ accountBaseline: Number(byId('ssAccountBaseline').value) || 0 });
        log('Existing Spreadshirt account count saved.', 'ok');
        await refreshUsage();
      } catch (error) { showError(error); }
    });
    byId('ssClearLog').addEventListener('click', () => { byId('ssLog').innerHTML = ''; });
  }

  async function hydrate() {
    await refresh();
    if (!activeProjectId) return;
    const p = await project();
    if (!p) { setActiveProject(null); return; }
    if (p.spreadshirt?.publishedAt) await renderPublished(p);
    else if (p.spreadshirt?.preparedAt) await renderFinalGate(p);
    else if (p.status === 'awaiting-review') await renderImageGate(p);
    else status(`Active Spreadshirt project: ${p.status}. Press Resume Active Project to continue.`);
  }

  function openWithInput(payload = {}) {
    byId('ssReferencePath').value = payload.referencePath || '';
    byId('ssSourceUrl').value = payload.sourceUrl || '';
    byId('ssNotes').value = '';
    document.querySelector('.nav[data-view="spreadshirtAlpha"]')?.click();
    status(`${payload.title || 'Flying Research design'} is ready. Press Start Spreadshirt Workflow once.`, 'ok');
    log(`Imported ${payload.title || payload.sourceUrl || 'Flying design'} into Spreadshirt Alpha.`, 'ok');
  }
  window.zeroPODSpreadshirtImport = openWithInput;

  function installFlyingButtons() {
    const decorate = () => {
      document.querySelectorAll('#frResults .fr-card').forEach((card) => {
        if (card.querySelector('[data-action="spreadshirt"]')) return;
        const actions = card.querySelector('.fr-actions');
        if (!actions) return;
        const button = document.createElement('button');
        button.dataset.action = 'spreadshirt';
        button.className = 'ss-flying-button';
        button.textContent = 'Send to Spreadshirt';
        actions.appendChild(button);
      });
    };
    const root = byId('frResults');
    if (root) {
      new MutationObserver(decorate).observe(root, { childList: true, subtree: true });
      decorate();
    } else {
      const timer = setInterval(() => {
        const later = byId('frResults');
        if (!later) return;
        clearInterval(timer);
        new MutationObserver(decorate).observe(later, { childList: true, subtree: true });
        decorate();
      }, 600);
      setTimeout(() => clearInterval(timer), 20000);
    }

    document.addEventListener('click', async (event) => {
      const button = event.target.closest?.('[data-action="spreadshirt"]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const key = button.closest('.fr-card')?.dataset.key;
      if (!key) return;
      button.disabled = true;
      button.textContent = 'Sending…';
      try {
        const result = await window.zeroPOD.flyingResearch.spreadshirt(key);
        openWithInput(result);
      } catch (error) {
        alert(`Could not send to Spreadshirt: ${error.message || error}`);
      } finally {
        button.disabled = false;
        button.textContent = 'Send to Spreadshirt';
      }
    }, true);
  }

  build();
  window.addEventListener('beforeunload', () => { if (timerHandle) clearInterval(timerHandle); });
})();