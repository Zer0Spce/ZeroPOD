(() => {
  if (window.__zeroPODSpreadshirtAlphaInstalled) return;
  window.__zeroPODSpreadshirtAlphaInstalled = true;
  const api = window.zeroPOD?.spreadshirt;
  if (!api) return;

  const ACTIVE_KEY = 'zeropod.spreadshirt.alpha.activeProject';
  const NEW_CHAT_KEY = 'zeropod.spreadshirt.alpha.newChat';
  let activeProjectId = localStorage.getItem(ACTIVE_KEY) || null;
  let busy = false;
  let lastGate = null;

  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const fileUrl = (value) => `file:///${String(value || '').replace(/\\/g, '/')}`;
  const formatBytes = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;

  function installStyles() {
    if (byId('spreadshirtAlphaStyles')) return;
    const style = document.createElement('style');
    style.id = 'spreadshirtAlphaStyles';
    style.textContent = `
      .ss-alpha-mark{font-weight:900}.ss-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:18px;align-items:start}.ss-panel{background:var(--surface,#171b21);border:1px solid var(--border,#2a313c);border-radius:14px;padding:16px;margin-bottom:16px}.ss-stage{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0 16px}.ss-stage span{padding:7px 10px;border:1px solid var(--border,#303744);border-radius:999px;font-size:11px;color:var(--muted,#98a3b2)}.ss-stage .current{border-color:var(--accent,#6875ff);color:var(--text,#fff)}.ss-stage .done{border-color:#355b48;color:#85ddb0}.ss-review{display:none}.ss-review.visible{display:block}.ss-preview{width:100%;max-height:560px;object-fit:contain;background:#090c0f;border:1px solid var(--border,#2a313c);border-radius:12px}.ss-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ss-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ss-step{padding:12px;border:1px solid var(--border,#2a313c);border-radius:12px;background:var(--surface-2,#11151a)}.ss-step strong{display:block;margin-bottom:5px}.ss-small{font-size:11px;color:var(--muted,#98a3b2);line-height:1.45}.ss-status{padding:10px 12px;border-radius:9px;background:var(--surface-2,#101419);margin-top:10px;white-space:pre-wrap}.ss-gates{display:grid;gap:7px}.ss-gate{display:flex;justify-content:space-between;gap:12px;padding:9px 10px;border-radius:9px;background:var(--surface-2,#101419)}.ss-gate.ok b{color:#85ddb0}.ss-gate.bad b{color:#ff9ba5}.ss-gate.warn b{color:#e9d27a}.ss-usage{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ss-usage-card{padding:12px;border:1px solid var(--border,#2a313c);border-radius:11px}.ss-usage-card strong{display:block;font-size:22px}.ss-metadata{display:grid;gap:10px}.ss-final-checks{display:grid;gap:8px;margin:12px 0}.ss-flying-button{font-weight:700}.ss-log{height:220px;overflow:auto;background:#090c0f;border:1px solid var(--border,#2a313c);border-radius:10px;padding:10px;font-family:Consolas,monospace;font-size:11px;line-height:1.5}.ss-log-line{margin-bottom:4px}.ss-log-line.error{color:#ff9ba5}.ss-log-line.ok{color:#85ddb0}.ss-badge{display:inline-flex;padding:3px 7px;border-radius:999px;background:#4a3d16;color:#f1d462;font-size:10px;font-weight:900;letter-spacing:.04em}@media(max-width:1050px){.ss-grid,.ss-card-grid,.ss-usage{grid-template-columns:1fr}}
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
      <div class="eyebrow">SEPARATE MARKETPLACE WORKFLOW</div>
      <div class="heading-row"><div><h2>Spreadshirt <strong>[ALPHA]</strong></h2><p class="muted">Reference → generation → image gate → POD metadata → vectorize → Spreadshirt PNG → upload → final gate → publish.</p></div><div id="ssProjectBadge" class="queue-state">No active project</div></div>
      <div class="ss-stage" id="ssStages"><span data-stage="generate">Generate</span><span data-stage="review">Image Check</span><span data-stage="metadata">Metadata</span><span data-stage="vector">Vectorize</span><span data-stage="export">Spreadshirt PNG</span><span data-stage="session">Session</span><span data-stage="upload">Upload</span><span data-stage="final">Final Check</span><span data-stage="publish">Publish</span></div>
      <div class="ss-grid">
        <div>
          <div class="ss-panel">
            <div class="heading-row"><div><h3>Start Spreadshirt Workflow</h3><p class="muted">Manual reference wins. If blank, ZeroPOD fetches the reference from the Amazon/source URL.</p></div><span class="ss-badge">ALPHA</span></div>
            <div class="form-grid">
              <label>Reference image<div class="file-row"><input id="ssReferencePath" readonly placeholder="Choose an image or use source URL" /><button id="ssChooseReference">Browse</button></div></label>
              <label>Amazon / source URL<input id="ssSourceUrl" type="url" placeholder="https://..." /></label>
              <label>Optional generation notes<textarea id="ssNotes" placeholder="Optional notes for ChatGPT…"></textarea></label>
              <label style="align-self:end"><input id="ssNewChat" type="checkbox" ${localStorage.getItem(NEW_CHAT_KEY) === '1' ? 'checked' : ''} /> New Chat</label>
            </div>
            <div class="ss-actions" style="margin-top:12px"><button id="ssStart" class="primary">Start Spreadshirt Workflow</button><button id="ssResume">Resume Active Project</button></div>
            <div id="ssStatus" class="ss-status muted">Ready.</div>
          </div>

          <div id="ssImageReview" class="ss-panel ss-review">
            <h3>Gate 1 · Generated Image</h3><p class="muted">Nothing continues until the design passes this check.</p>
            <img id="ssGeneratedImage" class="ss-preview" alt="Spreadshirt generated design" />
            <label style="margin-top:12px">Regeneration notes<textarea id="ssRegenerationNotes" placeholder="What should change?"></textarea></label>
            <div class="ss-actions" style="margin-top:10px"><button id="ssRegenerate" class="danger">Fail · Regenerate</button><button id="ssPassImage" class="primary">Pass · Continue</button></div>
          </div>

          <div class="ss-panel">
            <h3>Pipeline Steps</h3>
            <div class="ss-card-grid">
              <div class="ss-step"><strong>1. POD WINNER Metadata</strong><div class="ss-small">Generate the same approved ZeroPOD metadata foundation.</div><button id="ssGenerateMetadata">Generate Metadata</button></div>
              <div class="ss-step"><strong>2. Vectorizer.ai</strong><div class="ss-small">Vectorize only after the image gate passes.</div><button id="ssVectorize">Vectorize</button></div>
              <div class="ss-step"><strong>3. Spreadshirt PNG</strong><div class="ss-small">Transparent PNG, max 4000×4000 and 10 MB.</div><button id="ssExport">Export Spreadshirt PNG</button></div>
              <div class="ss-step"><strong>4. Spreadshirt Metadata</strong><div class="ss-small">Maps POD metadata to Spreadshirt name, description and keywords.</div><button id="ssBuildMetadata">Build Listing Metadata</button></div>
            </div>
          </div>

          <div class="ss-panel">
            <div class="heading-row"><div><h3>Spreadshirt Listing Metadata</h3><p class="muted">Editable before upload. Name ≤35 chars, description ≤200 chars, at least 3 keywords.</p></div><button id="ssSaveMetadata">Save</button></div>
            <div class="ss-metadata"><label>Design name<input id="ssMetaTitle" maxlength="35" /></label><label>Description<textarea id="ssMetaDescription" maxlength="200"></textarea></label><label>Keywords<textarea id="ssMetaKeywords" placeholder="Comma-separated"></textarea></label></div>
            <div id="ssMetaStatus" class="ss-small">No Spreadshirt metadata yet.</div>
          </div>

          <div class="ss-panel">
            <div class="heading-row"><div><h3>Spreadshirt Session</h3><p class="muted">Uses a separate persistent browser profile. Login/CAPTCHA/2FA stays manual.</p></div><span id="ssSessionState" class="queue-state">Not tested</span></div>
            <div class="ss-actions"><button id="ssLogin">Open Login Browser</button><button id="ssTest">Test Session</button><button id="ssOpen">Open Spreadshirt</button></div>
          </div>

          <div class="ss-panel">
            <div class="heading-row"><div><h3>Gate Checks</h3><p class="muted">Artwork, listing metadata, session and upload limits must pass before ZeroPOD prepares the listing.</p></div><button id="ssRunGate">Run Gate Check</button></div>
            <div id="ssGateResults" class="ss-gates"><div class="ss-gate warn"><span>Gate status</span><b>Not checked</b></div></div>
          </div>

          <div class="ss-panel">
            <h3>Upload & Final Review</h3>
            <p class="muted">Prepare uploads the artwork and fills metadata. Spreadshirt’s current Marketplace journey automatically optimizes presentation; review supercategories, clothing target groups, placement and contrast in the browser before publishing.</p>
            <div class="ss-actions"><button id="ssPrepare" class="primary">Prepare Spreadshirt Upload</button><button id="ssReviewBrowser">Open Final Browser Review</button></div>
            <div id="ssFinalChecks" class="ss-final-checks">
              <label><input type="checkbox" id="ssCheckSlogan" /> Slogan/spelling matches approved design</label>
              <label><input type="checkbox" id="ssCheckTrademark" /> Trademark/brand safety reviewed</label>
              <label><input type="checkbox" id="ssCheckProducts" /> Spreadshirt supercategories / target groups / placement reviewed</label>
              <label><input type="checkbox" id="ssCheckMetadata" /> Spreadshirt name / description / keywords reviewed</label>
            </div>
            <button id="ssPublish" class="primary">Pass · Publish to Spreadshirt</button>
            <div id="ssPublishStatus" class="ss-status muted">Not prepared.</div>
          </div>
        </div>

        <div>
          <div class="ss-panel"><h3>Upload Limits</h3><div class="ss-usage"><div class="ss-usage-card"><span class="ss-small">Daily</span><strong id="ssDailyUsage">0 / 10</strong><span id="ssDailyRemaining" class="ss-small">10 remaining</span></div><div class="ss-usage-card"><span class="ss-small">Account</span><strong id="ssAccountUsage">0 / 50</strong><span id="ssAccountRemaining" class="ss-small">50 remaining</span></div></div><label style="margin-top:12px">Existing published designs on this account<input id="ssAccountBaseline" type="number" min="0" step="1" value="0" /></label><button id="ssSaveBaseline">Save Existing Count</button><p class="ss-small">ZeroPOD counts verified Spreadshirt publishes it performs. Set the existing count once so the 50-account safety gate includes designs that were already in your account.</p></div>
          <div class="ss-panel"><h3>Spreadshirt Artwork</h3><div id="ssArtworkInfo" class="ss-small">No Spreadshirt PNG exported yet.</div><div id="ssArtworkPreview" style="margin-top:10px"></div></div>
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
    refresh().catch(() => {});
    setInterval(() => {
      if (section.classList.contains('active-view')) refresh().catch(() => {});
    }, 2500);
  }

  function log(message, kind = '') {
    const root = byId('ssLog');
    if (!root) return;
    const line = document.createElement('div');
    line.className = `ss-log-line ${kind}`;
    line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    root.appendChild(line);
    while (root.children.length > 200) root.removeChild(root.firstChild);
    root.scrollTop = root.scrollHeight;
  }

  function status(message, kind = '') {
    const root = byId('ssStatus');
    if (!root) return;
    root.textContent = message;
    root.className = `ss-status ${kind === 'error' ? 'validation-errors' : kind === 'ok' ? 'qc-good' : 'muted'}`;
  }
  function showError(error) { status(error?.message || String(error), 'error'); log(error?.message || String(error), 'error'); }
  function setBusy(next) { busy = Boolean(next); ['ssStart','ssGenerateMetadata','ssVectorize','ssExport','ssBuildMetadata','ssRunGate','ssPrepare','ssPublish'].forEach((id) => { const el = byId(id); if (el) el.disabled = busy || el.disabled; }); }

  function setActiveProject(projectId) {
    activeProjectId = projectId || null;
    if (activeProjectId) localStorage.setItem(ACTIVE_KEY, activeProjectId); else localStorage.removeItem(ACTIVE_KEY);
  }

  async function currentProject() {
    if (!activeProjectId) return null;
    try { return await window.zeroPOD.projects.get(activeProjectId); } catch { return null; }
  }

  function stageFor(project, gate) {
    if (!project) return 'generate';
    if (['created','generating','regenerating','chatgpt-recovery-needed','chatgpt-human-verification'].includes(project.status)) return 'generate';
    if (project.status === 'awaiting-review') return 'review';
    if (['approved-image','metadata-generating','metadata-recovery-needed'].includes(project.status)) return 'metadata';
    if (['metadata-ready','vectorizing','vectorizer-manual-download','vectorizer-recovery-needed'].includes(project.status)) return 'vector';
    if (project.status === 'vector-ready' && !project.spreadshirt?.pngPath) return 'export';
    if (project.spreadshirt?.pngPath && !project.spreadshirt?.metadata) return 'metadata';
    if ((gate?.session?.authStatus || '') !== 'verified') return 'session';
    if (!project.spreadshirt?.preparedAt) return 'upload';
    if (!project.spreadshirt?.publishedAt) return 'final';
    return 'publish';
  }

  function renderStages(name) {
    const order = ['generate','review','metadata','vector','export','session','upload','final','publish'];
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
    if (!gate) { root.innerHTML = '<div class="ss-gate warn"><span>Gate status</span><b>Not checked</b></div>'; return; }
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

  async function refresh() {
    const usage = await refreshUsage();
    const project = await currentProject();
    byId('ssProjectBadge').textContent = project?.id || 'No active project';
    byId('ssResume').disabled = !project;
    byId('ssStart').disabled = busy;
    if (!project) { renderStages('generate'); return; }

    const spread = project.spreadshirt || {};
    const meta = spread.metadata || {};
    if (document.activeElement !== byId('ssMetaTitle')) byId('ssMetaTitle').value = meta.title || '';
    if (document.activeElement !== byId('ssMetaDescription')) byId('ssMetaDescription').value = meta.description || '';
    if (document.activeElement !== byId('ssMetaKeywords')) byId('ssMetaKeywords').value = (meta.keywords || []).join(', ');
    byId('ssMetaStatus').textContent = spread.metadataUpdatedAt ? `Saved ${new Date(spread.metadataUpdatedAt).toLocaleString()}.` : 'No Spreadshirt metadata yet.';

    byId('ssImageReview').classList.toggle('visible', project.status === 'awaiting-review');
    if (project.status === 'awaiting-review' && project.generatedImagePath) byId('ssGeneratedImage').src = fileUrl(project.generatedImagePath);

    byId('ssGenerateMetadata').disabled = busy || !['approved-image','metadata-recovery-needed','metadata-ready'].includes(project.status);
    byId('ssVectorize').disabled = busy || !['metadata-ready','vectorizer-recovery-needed'].includes(project.status);
    byId('ssExport').disabled = busy || project.status !== 'vector-ready';
    byId('ssBuildMetadata').disabled = busy || !project.metadata;
    byId('ssSaveMetadata').disabled = busy || !meta.title;
    byId('ssPrepare').disabled = busy || !lastGate?.ok || Boolean(spread.preparedAt);

    const finalManual = ['ssCheckSlogan','ssCheckTrademark','ssCheckProducts','ssCheckMetadata'].every((id) => byId(id)?.checked);
    byId('ssPublish').disabled = busy || !spread.preparedAt || Boolean(spread.publishedAt) || !finalManual || usage.dailyBlocked || usage.accountBlocked;
    byId('ssPublishStatus').textContent = spread.publishedAt
      ? `Published ${new Date(spread.publishedAt).toLocaleString()}${spread.publishedUrl ? ` · ${spread.publishedUrl}` : ''}`
      : spread.preparedAt ? 'Prepared. Complete the browser review and four final checks before publishing.' : 'Not prepared.';

    if (spread.pngPath) {
      const info = spread.export || {};
      byId('ssArtworkInfo').textContent = `${info.width || '?'}×${info.height || '?'} · ${formatBytes(info.bytes)} · transparent ${info.transparent ? 'yes' : 'check required'}`;
      byId('ssArtworkPreview').innerHTML = `<img class="ss-preview" src="${esc(fileUrl(spread.pngPath))}" alt="Spreadshirt export" />`;
    }

    const statuses = await window.zeroPOD.connections.list().catch(() => ({}));
    byId('ssSessionState').textContent = statuses.spreadshirt?.authStatus === 'verified' ? 'Verified' : (statuses.spreadshirt?.authStatus || 'Not tested');
    renderStages(stageFor(project, lastGate));
    status(`Project ${project.id} · ${project.status}${spread.status ? ` · Spreadshirt ${spread.status}` : ''}`);
  }

  async function run(work, message) {
    if (busy) return;
    busy = true; if (message) { status(message); log(message); }
    try { const result = await work(); return result; }
    catch (error) { showError(error); throw error; }
    finally { busy = false; await refresh().catch(() => {}); }
  }

  async function startWorkflow() {
    let referencePath = byId('ssReferencePath').value.trim();
    const sourceUrl = byId('ssSourceUrl').value.trim();
    const notes = byId('ssNotes').value.trim();
    if (!referencePath && !sourceUrl) throw new Error('Choose a reference image or enter an Amazon/source URL.');
    if (!referencePath) {
      status('Fetching reference image from source URL…');
      const resolved = await window.zeroPOD.sourceImage.resolve(sourceUrl);
      referencePath = resolved.path;
      byId('ssReferencePath').value = referencePath;
      log(`Reference fetched from ${resolved.sourceType || 'source URL'}.`, 'ok');
    }
    if (byId('ssNewChat').checked) {
      localStorage.setItem(NEW_CHAT_KEY, '1');
      await window.zeroPOD.generation.newChat();
      log('Created one fresh ChatGPT conversation for this Spreadshirt workflow.', 'ok');
    } else localStorage.setItem(NEW_CHAT_KEY, '0');
    const result = await window.zeroPOD.generation.start({ referencePath, sourceUrl, reviewNotes: notes });
    setActiveProject(result.projectId);
    await api.markProject({ projectId: result.projectId, source: { source: 'spreadshirt-alpha' } });
    log(`Spreadshirt project ${result.projectId} started.`, 'ok');
  }

  function wire() {
    byId('ssChooseReference').addEventListener('click', async () => { const file = await window.zeroPOD.files.chooseReference(); if (file) byId('ssReferencePath').value = file; });
    byId('ssNewChat').addEventListener('change', () => localStorage.setItem(NEW_CHAT_KEY, byId('ssNewChat').checked ? '1' : '0'));
    byId('ssStart').addEventListener('click', () => run(startWorkflow, 'Starting Spreadshirt workflow…').catch(() => {}));
    byId('ssResume').addEventListener('click', () => refresh().catch(showError));
    byId('ssRegenerate').addEventListener('click', () => run(async () => { if (!activeProjectId) return; await window.zeroPOD.review.reject({ projectId: activeProjectId, notes: byId('ssRegenerationNotes').value.trim() }); }, 'Submitting regeneration…').catch(() => {}));
    byId('ssPassImage').addEventListener('click', () => run(async () => { await window.zeroPOD.review.pass({ projectId: activeProjectId }); log('Image gate passed.', 'ok'); }, 'Passing generated image…').catch(() => {}));
    byId('ssGenerateMetadata').addEventListener('click', () => run(() => window.zeroPOD.metadata.generate(activeProjectId), 'Generating POD WINNER metadata…').catch(() => {}));
    byId('ssVectorize').addEventListener('click', () => run(() => window.zeroPOD.vectorizer.start(activeProjectId), 'Vectorizing approved artwork…').catch(() => {}));
    byId('ssExport').addEventListener('click', () => run(() => api.exportPng(activeProjectId), 'Exporting Spreadshirt PNG…').catch(() => {}));
    byId('ssBuildMetadata').addEventListener('click', () => run(() => api.deriveMetadata(activeProjectId), 'Building Spreadshirt listing metadata…').catch(() => {}));
    byId('ssSaveMetadata').addEventListener('click', () => run(() => api.saveMetadata({ projectId: activeProjectId, metadata: { title: byId('ssMetaTitle').value, description: byId('ssMetaDescription').value, keywords: byId('ssMetaKeywords').value.split(',').map((v) => v.trim()).filter(Boolean) } }), 'Saving Spreadshirt metadata…').catch(() => {}));
    byId('ssLogin').addEventListener('click', () => run(() => api.login(), 'Opening Spreadshirt login browser…').catch(() => {}));
    byId('ssTest').addEventListener('click', () => run(async () => { const result = await api.test(); log(`Spreadshirt session: ${result.status}.`, result.status === 'verified' ? 'ok' : ''); }, 'Testing Spreadshirt session…').catch(() => {}));
    byId('ssOpen').addEventListener('click', () => api.open().catch(showError));
    byId('ssReviewBrowser').addEventListener('click', () => api.open().catch(showError));
    byId('ssRunGate').addEventListener('click', () => run(async () => { if (!activeProjectId) throw new Error('No Spreadshirt project selected.'); lastGate = await api.check(activeProjectId); renderGate(lastGate); log(lastGate.ok ? 'All Spreadshirt prepare gates passed.' : 'Spreadshirt gate check found blocking items.', lastGate.ok ? 'ok' : 'error'); return lastGate; }, 'Running Spreadshirt gate checks…').catch(() => {}));
    byId('ssPrepare').addEventListener('click', () => run(async () => { lastGate = await api.check(activeProjectId); renderGate(lastGate); if (!lastGate.ok) throw new Error(lastGate.errors.join(' ')); const result = await api.prepare(activeProjectId); log(result.message, 'ok'); }, 'Preparing Spreadshirt listing…').catch(() => {}));
    byId('ssPublish').addEventListener('click', () => run(async () => { const result = await api.publish(activeProjectId); log('Spreadshirt publish verified.', 'ok'); lastGate = await api.check(activeProjectId); renderGate(lastGate); return result; }, 'Publishing to Spreadshirt…').catch(() => {}));
    ['ssCheckSlogan','ssCheckTrademark','ssCheckProducts','ssCheckMetadata'].forEach((id) => byId(id).addEventListener('change', () => refresh().catch(() => {})));
    byId('ssSaveBaseline').addEventListener('click', () => run(() => api.updateSettings({ accountBaseline: Number(byId('ssAccountBaseline').value) || 0 }), 'Saving existing Spreadshirt account count…').catch(() => {}));
    byId('ssClearLog').addEventListener('click', () => { byId('ssLog').innerHTML = ''; });
  }

  function openWithInput(payload = {}) {
    byId('ssReferencePath').value = payload.referencePath || '';
    byId('ssSourceUrl').value = payload.sourceUrl || '';
    byId('ssNotes').value = '';
    document.querySelector('.nav[data-view="spreadshirtAlpha"]')?.click();
    status(`${payload.title || 'Flying Research design'} is ready for the Spreadshirt workflow. Press Start when ready.`, 'ok');
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
      event.preventDefault(); event.stopPropagation();
      const card = button.closest('.fr-card');
      const key = card?.dataset.key;
      if (!key) return;
      button.disabled = true; button.textContent = 'Sending…';
      try {
        const result = await window.zeroPOD.flyingResearch.spreadshirt(key);
        openWithInput(result);
      } catch (error) {
        alert(`Could not send to Spreadshirt: ${error.message || error}`);
      } finally {
        button.disabled = false; button.textContent = 'Send to Spreadshirt';
      }
    }, true);
  }

  build();
})();
