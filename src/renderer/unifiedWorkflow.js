(() => {
  const ACTIVE_KEY = 'zeropod.unified.activeProject.v1';
  const AUTO_KEY = 'zeropod.unified.automateEverything.v1';
  const seenActivity = new Set();
  let activeProjectId = localStorage.getItem(ACTIVE_KEY) || null;
  let running = false;
  let selectedAutoMode = localStorage.getItem(AUTO_KEY) === 'true';
  let pollTimer = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fileUrl = (filePath) => `file:///${String(filePath || '').replace(/\\/g, '/')}`;

  function installStyles() {
    if (document.getElementById('unifiedWorkflowStyles')) return;
    const style = document.createElement('style');
    style.id = 'unifiedWorkflowStyles';
    style.textContent = `
      .uw-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:18px;align-items:start}
      .uw-panel{background:#171b21;border:1px solid #2a313c;border-radius:14px;padding:16px;margin:0 0 16px}
      .uw-panel h3{margin:0 0 8px}.uw-stage{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 16px}.uw-stage span{padding:7px 10px;border-radius:999px;background:#11151a;border:1px solid #303744;font-size:12px;color:#8f99a8}.uw-stage span.current{border-color:#6875ff;color:#dce0ff}.uw-stage span.done{color:#85ddb0;border-color:#355b48}
      .uw-auto{display:flex;gap:11px;align-items:flex-start;padding:13px 14px;border:1px solid #62522b;background:#241f12;border-radius:12px}.uw-auto input{margin-top:3px}.uw-auto strong{display:block}.uw-beta{font-size:11px;color:#e9d27a;line-height:1.45;margin-top:4px}
      .uw-review{display:none}.uw-review.visible{display:block}.uw-review-image{width:100%;max-height:610px;object-fit:contain;background:#0b0d10;border-radius:12px;border:1px solid #2a313c}.uw-review-actions{display:flex;gap:9px;margin-top:12px;flex-wrap:wrap}
      .uw-final-grid{display:grid;grid-template-columns:minmax(240px,.8fr) minmax(300px,1.2fr);gap:14px}.uw-shirt{width:100%;max-height:460px;object-fit:contain;background:#0b0d10;border-radius:10px}.uw-meta{display:grid;gap:10px}.uw-meta-row{padding:10px 12px;background:#101419;border-radius:9px}.uw-meta-row b{display:block;font-size:11px;color:#8f99a8;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}.uw-tags{line-height:1.55;word-break:break-word}
      .uw-log{height:250px;overflow:auto;background:#090c0f;border:1px solid #2a313c;border-radius:10px;padding:10px;font-family:Consolas,monospace;font-size:11px;line-height:1.55}.uw-log-line{display:grid;grid-template-columns:78px 1fr;gap:8px}.uw-log-time{color:#687588}.uw-log-error{color:#ff9ba5}.uw-log-ok{color:#85ddb0}.uw-log-warn{color:#e9d27a}
      .uw-status{padding:10px 12px;border-radius:9px;background:#101419;margin-top:10px;min-height:20px}.uw-inputs{display:grid;grid-template-columns:1fr 1fr;gap:12px}.uw-full{grid-column:1/-1}.uw-hidden-nav{display:none!important}.uw-preview-missing{padding:30px;text-align:center;background:#0b0d10;border-radius:10px;color:#8f99a8}
      @media(max-width:1050px){.uw-grid,.uw-final-grid,.uw-inputs{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function buildUnifiedView() {
    installStyles();
    const createNav = document.querySelector('.nav[data-view="create"]');
    if (createNav) createNav.textContent = 'Workflow';
    ['review', 'workflow', 'upload'].forEach((view) => document.querySelector(`.nav[data-view="${view}"]`)?.classList.add('uw-hidden-nav'));

    const section = document.getElementById('create');
    if (!section) return;
    section.innerHTML = `
      <div class="eyebrow">ONE-CLICK POD PIPELINE</div>
      <div class="heading-row"><div><h2>Workflow</h2><p class="muted">Create → image review → metadata → vectorize → export → Redbubble → final review → publish.</p></div><div id="uwProjectBadge" class="queue-state">No active project</div></div>
      <div class="uw-grid">
        <div>
          <div class="uw-panel">
            <h3>Start</h3>
            <div class="uw-inputs">
              <label>Reference image<div class="file-row"><input id="uwReferencePath" readonly placeholder="Choose an image" /><button id="uwChooseReference">Browse</button></div></label>
              <label>Amazon / source URL<input id="uwSourceUrl" type="url" placeholder="https://..." /></label>
              <label class="uw-full">Optional generation / regeneration notes<textarea id="uwNotes" placeholder="Optional notes for ChatGPT…"></textarea></label>
            </div>
            <div class="uw-auto" style="margin-top:12px">
              <input type="checkbox" id="uwAutomateEverything" ${selectedAutoMode ? 'checked' : ''} />
              <div><strong>Automate everything <span class="uw-beta">BETA</span></strong><div class="uw-beta">Skips both approval checks and automatically publishes when Redbubble is ready. Beta automation cannot guarantee product placement, listing accuracy, or the final Redbubble result. Use only when you accept that risk.</div></div>
            </div>
            <div class="uw-review-actions"><button class="primary" id="uwStart">Start Workflow</button><button id="uwResume" class="secondary">Resume Active Project</button></div>
            <div id="uwStatus" class="uw-status muted">Ready.</div>
          </div>

          <div class="uw-stage" id="uwStages">
            <span data-stage="generate">Generate</span><span data-stage="review1">Image Check</span><span data-stage="metadata">Metadata</span><span data-stage="vector">Vectorize</span><span data-stage="export">Export</span><span data-stage="redbubble">Redbubble</span><span data-stage="review2">Final Check</span><span data-stage="publish">Publish</span>
          </div>

          <div id="uwImageReview" class="uw-panel uw-review">
            <h3>Check 1 · Generated Image</h3>
            <p class="muted">This is the only design-quality gate. Pass continues the entire middle workflow automatically.</p>
            <img id="uwGeneratedImage" class="uw-review-image" alt="Generated design" />
            <label style="margin-top:12px">Regeneration notes<textarea id="uwRegenerationNotes" placeholder="What should change?"></textarea></label>
            <div class="uw-review-actions"><button class="danger" id="uwRegenerate">Fail · Regenerate</button><button class="primary" id="uwPassImage">Pass · Continue Workflow</button></div>
          </div>

          <div id="uwFinalReview" class="uw-panel uw-review">
            <h3>Check 2 · Redbubble Final Review</h3>
            <p class="muted">Review exactly what ZeroPOD prepared plus one Redbubble product preview. Description is intentionally skipped in the current beta.</p>
            <div class="uw-final-grid">
              <div id="uwShirtPreviewWrap"><div class="uw-preview-missing">Waiting for Redbubble shirt preview…</div></div>
              <div class="uw-meta">
                <div class="uw-meta-row"><b>Title</b><span id="uwFinalTitle">—</span></div>
                <div class="uw-meta-row"><b>Main Tag</b><span id="uwFinalMainTag">—</span></div>
                <div class="uw-meta-row"><b>Supporting Tags</b><span id="uwFinalTags" class="uw-tags">—</span></div>
                <div class="uw-meta-row"><b>Artwork</b><span id="uwFinalArtwork">—</span></div>
                <div class="uw-meta-row"><b>Description</b><span>Skipped for beta</span></div>
              </div>
            </div>
            <div class="uw-review-actions"><button class="danger" id="uwRedoFinal">Fail · Redo Redbubble Prep</button><button class="primary" id="uwPublish">Pass · Publish</button></div>
          </div>

          <div id="uwPublished" class="uw-panel uw-review"><h3>Published ✓</h3><div id="uwPublishedText" class="muted"></div></div>
        </div>

        <div class="uw-panel">
          <div class="heading-row"><div><h3>Live Automation Log</h3><div class="last-seen">Every major pipeline action appears here.</div></div><button id="uwClearLog" class="secondary">Clear</button></div>
          <div id="uwLog" class="uw-log"></div>
        </div>
      </div>`;

    wireUnifiedControls();
  }

  function log(message, kind = '') {
    const root = document.getElementById('uwLog');
    if (!root) return;
    const now = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `uw-log-line ${kind ? `uw-log-${kind}` : ''}`;
    line.innerHTML = `<span class="uw-log-time">${esc(now)}</span><span>${esc(message)}</span>`;
    root.appendChild(line);
    while (root.children.length > 250) root.removeChild(root.firstChild);
    root.scrollTop = root.scrollHeight;
  }

  function setStatus(text, kind = '') {
    const root = document.getElementById('uwStatus');
    if (!root) return;
    root.textContent = text;
    root.className = `uw-status ${kind === 'error' ? 'validation-errors' : kind === 'ok' ? 'qc-good' : 'muted'}`;
  }

  function stage(name) {
    const order = ['generate', 'review1', 'metadata', 'vector', 'export', 'redbubble', 'review2', 'publish'];
    const index = order.indexOf(name);
    document.querySelectorAll('#uwStages [data-stage]').forEach((el) => {
      const i = order.indexOf(el.dataset.stage);
      el.classList.toggle('done', index >= 0 && i < index);
      el.classList.toggle('current', i === index);
    });
  }

  function setActiveProject(projectId) {
    activeProjectId = projectId || null;
    if (activeProjectId) localStorage.setItem(ACTIVE_KEY, activeProjectId);
    else localStorage.removeItem(ACTIVE_KEY);
    try { currentProjectId = activeProjectId; } catch {}
    const badge = document.getElementById('uwProjectBadge');
    if (badge) badge.textContent = activeProjectId || 'No active project';
  }

  async function project() {
    if (!activeProjectId) return null;
    try { return await window.zeroPOD.projects.get(activeProjectId); }
    catch { return null; }
  }

  async function waitForProjectStatus(terminal, timeoutMs = 240000) {
    const wanted = new Set(terminal);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const p = await project();
      if (!p) return null;
      if (wanted.has(p.status)) return p;
      if (/recovery-needed$/.test(p.status)) return p;
      await sleep(1200);
    }
    return project();
  }

  async function renderImageGate(p = null) {
    p ||= await project();
    if (!p) return;
    stage('review1');
    const panel = document.getElementById('uwImageReview');
    panel.classList.add('visible');
    document.getElementById('uwFinalReview').classList.remove('visible');
    document.getElementById('uwPublished').classList.remove('visible');
    const img = document.getElementById('uwGeneratedImage');
    if (p.generatedImagePath) img.src = fileUrl(p.generatedImagePath);
    document.getElementById('uwRegenerationNotes').value = p.review?.notes || '';
    setStatus('Generated image is ready for Check 1.');
    log('Generated image ready for review.', 'ok');
  }

  async function renderFinalGate(p = null) {
    p ||= await project();
    if (!p) return;
    stage('review2');
    document.getElementById('uwImageReview').classList.remove('visible');
    const panel = document.getElementById('uwFinalReview');
    panel.classList.add('visible');
    document.getElementById('uwPublished').classList.remove('visible');
    const rb = p.redbubble || {};
    const meta = p.metadata || {};
    document.getElementById('uwFinalTitle').textContent = rb.title || meta.title || '—';
    document.getElementById('uwFinalMainTag').textContent = meta.mainTag || '—';
    document.getElementById('uwFinalTags').textContent = rb.tags || [meta.mainTag, ...(meta.supportingTags || [])].filter(Boolean).join(', ') || '—';
    document.getElementById('uwFinalArtwork').textContent = p.finalPngPath ? '4500×5400 exported PNG prepared' : '—';
    const wrap = document.getElementById('uwShirtPreviewWrap');
    if (rb.reviewScreenshotPath) wrap.innerHTML = `<img class="uw-shirt" src="${esc(fileUrl(rb.reviewScreenshotPath))}" alt="Redbubble shirt preview">`;
    else wrap.innerHTML = '<div class="uw-preview-missing">Shirt preview capture was unavailable. Check the docked Redbubble browser before publishing.</div>';
    setStatus('Redbubble is prepared. Check the listing data and product preview, then publish or redo.');
    log('Redbubble preparation complete. Waiting for final approval.', 'ok');
  }

  async function renderPublished(p = null) {
    p ||= await project();
    stage('publish');
    document.getElementById('uwImageReview').classList.remove('visible');
    document.getElementById('uwFinalReview').classList.remove('visible');
    const panel = document.getElementById('uwPublished');
    panel.classList.add('visible');
    document.getElementById('uwPublishedText').textContent = p?.redbubble?.publishedUrl ? `Verified: ${p.redbubble.publishedUrl}` : 'Redbubble confirmed the work was published.';
    setStatus('Workflow complete · Published ✓', 'ok');
    log('Workflow complete. Redbubble publish verified.', 'ok');
  }

  async function syncActivity() {
    const p = await project();
    if (!p) return;
    for (const item of (p.activity || [])) {
      const key = `${item.at}|${item.type}|${item.label}`;
      if (seenActivity.has(key)) continue;
      seenActivity.add(key);
      log(item.label || item.type || 'Project event');
    }
  }

  async function publishActive() {
    if (!activeProjectId) return;
    stage('publish');
    setStatus('Publishing Redbubble work…');
    log('Checking Redbubble agreement and publishing…');
    const result = await window.zeroPOD.redbubble.publish(activeProjectId);
    const p = result?.project || await project();
    await renderPublished(p);
  }

  async function runPostApprovalPipeline(autoMode = selectedAutoMode) {
    if (!activeProjectId || running) return;
    running = true;
    document.getElementById('uwImageReview').classList.remove('visible');
    try {
      let p = await project();
      while (p) {
        await syncActivity();
        if (p.status === 'approved-image' || p.status === 'metadata-recovery-needed') {
          stage('metadata');
          setStatus('Generating POD WINNER metadata…');
          log('Generating POD WINNER metadata in ChatGPT…');
          await window.zeroPOD.metadata.generate(activeProjectId);
        } else if (p.status === 'metadata-ready' || p.status === 'vectorizer-recovery-needed') {
          stage('vector');
          setStatus('Vectorizing approved design…');
          log('Opening Vectorizer.ai and vectorizing approved artwork…');
          await window.zeroPOD.vectorizer.start(activeProjectId);
        } else if (p.status === 'vector-ready') {
          stage('export');
          setStatus('Exporting transparent 4500×5400 PNG…');
          log('Exporting final transparent 4500×5400 PNG…');
          await window.zeroPOD.export.png(activeProjectId);
        } else if (p.status === 'export-ready' || p.status === 'redbubble-recovery-needed') {
          stage('redbubble');
          setStatus('Preparing Redbubble copy…');
          log('Preparing Redbubble: copy settings → replace image → title/tags. Quality check skipped by unified workflow.');
          await window.zeroPOD.redbubble.prepare(activeProjectId);
        } else if (p.status === 'redbubble-review') {
          if (autoMode) {
            log('AUTOMATE EVERYTHING beta enabled: skipping final review and publishing automatically.', 'warn');
            await publishActive();
          } else {
            await renderFinalGate(p);
          }
          return;
        } else if (p.status === 'published') {
          await renderPublished(p);
          return;
        } else if (p.status === 'redbubble-publish-pending') {
          if (autoMode) await publishActive();
          else await renderFinalGate(p);
          return;
        } else if (/recovery-needed$/.test(p.status)) {
          throw new Error(p.lastAutomationError?.message || p.metadataError?.message || p.chatgptError?.message || `Workflow needs attention at ${p.status}.`);
        } else {
          // Give asynchronous service callbacks a short chance to settle to the next persisted state.
          await sleep(900);
        }
        p = await project();
      }
    } catch (error) {
      setStatus(`Workflow needs attention: ${error.message || error}`, 'error');
      log(`ERROR: ${error.message || error}`, 'error');
    } finally {
      running = false;
      await syncActivity();
    }
  }

  async function approveImageAndContinue() {
    if (!activeProjectId || running) return;
    running = true;
    try {
      setStatus('Approving generated image…');
      log('Image passed. Approving design and continuing automatically…', 'ok');
      await window.zeroPOD.review.pass({ projectId: activeProjectId });
    } catch (error) {
      setStatus(`Could not approve image: ${error.message || error}`, 'error');
      log(`ERROR approving image: ${error.message || error}`, 'error');
      running = false;
      return;
    }
    running = false;
    await runPostApprovalPipeline(selectedAutoMode);
  }

  async function startWorkflow() {
    if (running) return;
    const referencePath = document.getElementById('uwReferencePath').value.trim();
    const sourceUrl = document.getElementById('uwSourceUrl').value.trim();
    const notes = document.getElementById('uwNotes').value.trim();
    if (!referencePath) return setStatus('Choose a reference image first.', 'error');
    selectedAutoMode = document.getElementById('uwAutomateEverything').checked;
    localStorage.setItem(AUTO_KEY, String(selectedAutoMode));
    running = true;
    seenActivity.clear();
    document.getElementById('uwImageReview').classList.remove('visible');
    document.getElementById('uwFinalReview').classList.remove('visible');
    document.getElementById('uwPublished').classList.remove('visible');
    stage('generate');
    setStatus('Opening ChatGPT and generating design…');
    log(`Starting workflow${selectedAutoMode ? ' · AUTOMATE EVERYTHING BETA' : ''}.`, selectedAutoMode ? 'warn' : '');
    try {
      const result = await window.zeroPOD.generation.start({ referencePath, sourceUrl, reviewNotes: notes });
      setActiveProject(result.projectId);
      await syncActivity();
      let p = await project();
      if (p?.status !== 'awaiting-review') p = await waitForProjectStatus(['awaiting-review', 'chatgpt-recovery-needed']);
      if (!p || p.status !== 'awaiting-review') throw new Error(p?.chatgptError?.message || 'Generated image did not reach the review state.');
      if (selectedAutoMode) {
        log('AUTOMATE EVERYTHING beta enabled: skipping generated-image approval.', 'warn');
        await window.zeroPOD.review.pass({ projectId: activeProjectId });
        running = false;
        await runPostApprovalPipeline(true);
        return;
      }
      await renderImageGate(p);
    } catch (error) {
      setStatus(`Workflow could not continue: ${error.message || error}`, 'error');
      log(`ERROR: ${error.message || error}`, 'error');
    } finally {
      running = false;
      await syncActivity();
    }
  }

  async function regenerateImage() {
    if (!activeProjectId || running) return;
    running = true;
    const notes = document.getElementById('uwRegenerationNotes').value.trim();
    try {
      stage('generate');
      setStatus('Regenerating image in ChatGPT…');
      log(`Image failed. Regenerating${notes ? ` with notes: ${notes}` : ''}…`, 'warn');
      await window.zeroPOD.review.reject({ projectId: activeProjectId, notes });
      let p = await project();
      if (p?.status !== 'awaiting-review') p = await waitForProjectStatus(['awaiting-review', 'chatgpt-recovery-needed']);
      if (!p || p.status !== 'awaiting-review') throw new Error(p?.chatgptError?.message || 'Regeneration did not return a reviewable image.');
      await renderImageGate(p);
    } catch (error) {
      setStatus(`Regeneration failed: ${error.message || error}`, 'error');
      log(`ERROR: ${error.message || error}`, 'error');
    } finally {
      running = false;
      await syncActivity();
    }
  }

  async function redoFinalPrep() {
    if (!activeProjectId || running) return;
    running = true;
    try {
      stage('redbubble');
      setStatus('Redoing Redbubble preparation…');
      log('Final check failed. Re-running Redbubble preparation with the approved artwork and saved metadata…', 'warn');
      await window.zeroPOD.redbubble.prepare(activeProjectId);
      await renderFinalGate(await project());
    } catch (error) {
      setStatus(`Redbubble redo failed: ${error.message || error}`, 'error');
      log(`ERROR: ${error.message || error}`, 'error');
    } finally {
      running = false;
      await syncActivity();
    }
  }

  async function resumeWorkflow() {
    if (!activeProjectId) {
      const projects = await window.zeroPOD.projects.list();
      const candidate = projects.find((p) => p.status !== 'published');
      if (candidate) setActiveProject(candidate.id);
    }
    const p = await project();
    if (!p) return setStatus('No active project to resume.', 'error');
    log(`Resuming ${p.id} from ${p.status}.`);
    if (p.status === 'awaiting-review') {
      if (selectedAutoMode) {
        await window.zeroPOD.review.pass({ projectId: activeProjectId });
        await runPostApprovalPipeline(true);
      } else await renderImageGate(p);
    } else if (p.status === 'redbubble-review' || p.status === 'redbubble-publish-pending') {
      if (selectedAutoMode) await publishActive(); else await renderFinalGate(p);
    } else if (p.status === 'published') await renderPublished(p);
    else await runPostApprovalPipeline(selectedAutoMode);
  }

  function wireUnifiedControls() {
    document.getElementById('uwChooseReference').addEventListener('click', async () => {
      const file = await window.zeroPOD.files.chooseReference();
      if (file) document.getElementById('uwReferencePath').value = file;
    });
    document.getElementById('uwAutomateEverything').addEventListener('change', (event) => {
      selectedAutoMode = event.target.checked;
      localStorage.setItem(AUTO_KEY, String(selectedAutoMode));
      log(selectedAutoMode ? 'Automate everything BETA enabled.' : 'Automate everything disabled.', selectedAutoMode ? 'warn' : '');
    });
    document.getElementById('uwStart').addEventListener('click', startWorkflow);
    document.getElementById('uwResume').addEventListener('click', resumeWorkflow);
    document.getElementById('uwRegenerate').addEventListener('click', regenerateImage);
    document.getElementById('uwPassImage').addEventListener('click', approveImageAndContinue);
    document.getElementById('uwRedoFinal').addEventListener('click', redoFinalPrep);
    document.getElementById('uwPublish').addEventListener('click', async () => {
      if (running) return;
      running = true;
      try { await publishActive(); }
      catch (error) { setStatus(`Publish failed: ${error.message || error}`, 'error'); log(`ERROR publishing: ${error.message || error}`, 'error'); }
      finally { running = false; await syncActivity(); }
    });
    document.getElementById('uwClearLog').addEventListener('click', () => { document.getElementById('uwLog').innerHTML = ''; });
  }

  async function hydrate() {
    if (!activeProjectId) return;
    const p = await project();
    if (!p) { setActiveProject(null); return; }
    setActiveProject(p.id);
    await syncActivity();
    if (p.status === 'awaiting-review') await renderImageGate(p);
    else if (p.status === 'redbubble-review' || p.status === 'redbubble-publish-pending') await renderFinalGate(p);
    else if (p.status === 'published') await renderPublished(p);
    else setStatus(`Active project: ${p.workflow?.label || p.status}. Press Resume Active Project to continue.`);
  }

  buildUnifiedView();
  hydrate().catch(() => {});
  pollTimer = setInterval(() => {
    if (document.getElementById('create')?.classList.contains('active-view')) syncActivity().catch(() => {});
  }, 1400);
  window.addEventListener('beforeunload', () => { if (pollTimer) clearInterval(pollTimer); });
})();
