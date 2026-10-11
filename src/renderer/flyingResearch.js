(() => {
  const api = window.zeroPOD?.flyingResearch;
  if (!api) return;
  const selected = new Set();
  let items = [], tools = {}, busy = false, tool = 'best', savedOnly = false, loadedOnce = false;
  let view = localStorage.getItem('zeropod.flying.view') || 'grid';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const fmt = (v) => v === null || v === undefined ? '—' : Number(v).toLocaleString();
  const byId = (id) => document.getElementById(id);
  const main = document.querySelector('main.content');
  const nav = document.createElement('button');
  nav.className = 'nav'; nav.dataset.view = 'flyingResearch'; nav.textContent = 'Flying Research BETA';
  const anchor = document.querySelector('.nav[data-view="automation"]');
  if (!main || !anchor) return;
  anchor.insertAdjacentElement('afterend', nav);
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'flyingResearch.css'; document.head.appendChild(css);
  const section = document.createElement('section'); section.id = 'flyingResearch'; section.className = 'view';
  section.innerHTML = `
    <div class="eyebrow">FLYING RESEARCH CONNECTION</div>
    <div class="heading-row"><div><h2>Flying Research BETA</h2><p class="muted">Explore Flying’s live tools. Bring matching design images and Amazon links into ZeroPOD.</p></div><span id="frSession" class="queue-state">Not tested</span></div>
    <div class="fr-actions"><button id="frLogin">Open Login Browser</button><button id="frTest">Test Session</button><button id="frOpen">Open Flying Tools</button><button class="primary" id="frCapture">Import Current Results</button></div>
    <p class="fr-small">Sign in once in ZeroPOD’s dedicated browser, then Test Session. Set advanced filters, statistics, niche analysis, keywords, or FLAI inside Flying; import the loaded results here.</p>
    <div id="frTools" class="fr-tools"></div>
    <div class="panel"><div class="fr-controls">
      <label>Keyword / niche<input id="frQuery" placeholder="Search Flying Research" /></label>
      <label>Marketplace<select id="frMarketplace"><option value="ALL">All Marketplaces</option></select></label>
      <label>Product<select id="frProduct"></select></label>
    </div><div class="fr-actions" style="margin-top:12px"><button class="primary" id="frSearch">Search Flying</button><button id="frLoad">Show Imported</button><button id="frSaved">Saved in ZeroPOD</button><button id="frGrid">Grid</button><button id="frList">List</button></div>
    <div class="fr-filters">
      <label>Filter imported designs<input id="frFilter" placeholder="Title / ASIN / brand" /></label>
      <label>Sort<select id="frSort"><option value="bsr">Lowest BSR</option><option value="trends">30-day improvement</option><option value="sales">Estimated sales</option><option value="newest">Newest published</option><option value="reviews">Lowest reviews</option><option value="price">Lowest price</option></select></label>
      <label>BSR min<input id="frBsrMin" type="number" min="1" /></label><label>BSR max<input id="frBsrMax" type="number" min="1" /></label>
      <label>Price min<input id="frPriceMin" type="number" min="0" step="0.01" /></label><label>Price max<input id="frPriceMax" type="number" min="0" step="0.01" /></label>
      <label>Rating min<input id="frRating" type="number" min="0" max="5" step="0.1" /></label><label>Reviews max<input id="frReviews" type="number" min="0" /></label>
      <label>Published from<input id="frFrom" type="date" /></label><label>Published to<input id="frTo" type="date" /></label>
      <label class="fr-check"><input id="frHideBrands" type="checkbox" checked /> Hide potential brand/licensed designs</label>
      <button id="frReset">Reset Filters</button>
    </div></div>
    <div id="frNotice" class="fr-notice" role="status">Best Sellers loads automatically when this tab opens. Select another results tab to load its designs.</div>
    <div class="fr-head"><strong id="frCount">0 designs</strong><div class="fr-actions"><label class="fr-check"><input id="frSelectAll" type="checkbox" /> Select all visible</label><button id="frClear">Clear Selection</button></div></div>
    <div id="frResults" class="fr-results"></div>
    <div class="fr-selection"><strong id="frSelected">0 selected</strong><div class="fr-actions"><button id="frWorkflow">Send to Workflow</button><button class="primary" id="frAutomation">Send to Automations</button></div></div>
    <p class="fr-small">Flying sales figures are estimates. Flying Best Sellers results are source data; they do not imply an independently verified Amazon Best Sellers position. Workflow takes one design; Automations accepts multiple designs within its existing 15-row limit.</p>
    <div id="frDetail" class="fr-detail" hidden></div>`;
  main.appendChild(section);

  // Legacy navigation caches its views at startup. Hide this dynamic view explicitly.
  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('.nav[data-view]');
    if (target && target !== nav) { section.classList.remove('active-view'); nav.classList.remove('active'); }
  }, true);
  nav.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach((el) => el.classList.toggle('active', el === nav));
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active-view', el === section));
    if (!loadedOnce) action(async () => { await optionsReady; await loadTool(); }, 'Loading Best Sellers from Flying Research…');
  });
  function notice(text, error = false) { byId('frNotice').textContent = text; byId('frNotice').classList.toggle('error', error); }
  function showError(error) { notice(error?.message || String(error), true); }
  async function action(work, message) {
    if (busy) return;
    busy = true; render(); if (message) notice(message);
    try { await work(); } catch (error) { showError(error); }
    finally { busy = false; render(); }
  }
  async function load() { items = await api.list(); render(); }
  function filtered() {
    const q = byId('frFilter').value.trim().toLowerCase();
    const marketplace = byId('frMarketplace').value;
    const ranges = [['frBsrMin','bsr',true],['frBsrMax','bsr',false],['frPriceMin','priceValue',true],['frPriceMax','priceValue',false],['frRating','rating',true],['frReviews','reviewCount',false]];
    let result = items.filter((item) => (!savedOnly || item.saved) && (marketplace === 'ALL' || item.marketplace === marketplace) && (!byId('frHideBrands').checked || !item.trademarkRisk) && (!q || [item.title,item.asin,item.brand].some((v) => String(v || '').toLowerCase().includes(q))));
    for (const [id, field, min] of ranges) if (byId(id).value !== '') result = result.filter((item) => item[field] !== null && item[field] !== undefined && (min ? item[field] >= Number(byId(id).value) : item[field] <= Number(byId(id).value)));
    const from = byId('frFrom').value, to = byId('frTo').value;
    if (from || to) result = result.filter((item) => { const date = new Date(item.dateFirstAvailable).getTime(); return Number.isFinite(date) && (!from || date >= new Date(from).getTime()) && (!to || date < new Date(to).getTime()+86400000); });
    const sort = byId('frSort').value;
    const field = ({bsr:'bsr',trends:'improvementPercent',sales:'estimatedSales30',reviews:'reviewCount',price:'priceValue'})[sort];
    const desc = ['trends','sales'].includes(sort);
    result.sort((a,b) => {
      if (sort === 'newest') return (new Date(b.dateFirstAvailable).getTime() || 0) - (new Date(a.dateFirstAvailable).getTime() || 0);
      const av = a[field] ?? (desc ? -Infinity : Infinity), bv = b[field] ?? (desc ? -Infinity : Infinity);
      return desc ? bv-av : av-bv;
    });
    return result;
  }
  function image(item) { return item.cachedImagePath ? encodeURI(`file:///${item.cachedImagePath.replace(/\\/g,'/')}`) : item.imageUrl; }
  function render() {
    const visible = filtered();
    byId('frCount').textContent = `${visible.length} designs${savedOnly ? ' · Saved in ZeroPOD' : ''}`;
    byId('frSelected').textContent = `${selected.size} selected`;
    byId('frSelectAll').checked = visible.length > 0 && visible.every((item) => selected.has(item.key));
    byId('frSelectAll').indeterminate = visible.some((item) => selected.has(item.key)) && !byId('frSelectAll').checked;
    byId('frResults').classList.toggle('fr-list', view === 'list');
    byId('frWorkflow').disabled = busy || selected.size !== 1;
    byId('frAutomation').disabled = busy || !selected.size;
    for (const id of ['frLogin','frTest','frOpen','frSearch','frCapture','frLoad']) byId(id).disabled = busy;
    byId('frSelectAll').disabled = busy;
    byId('frTools').querySelectorAll('button').forEach((button) => { button.disabled = busy; button.classList.toggle('active', button.dataset.tool === tool); });
    byId('frResults').innerHTML = visible.length ? visible.map((item) => `<article class="fr-card ${selected.has(item.key)?'selected':''}" data-key="${esc(item.key)}">
      <input type="checkbox" data-select="${esc(item.key)}" aria-label="Select ${esc(item.title)}" ${selected.has(item.key)?'checked':''} ${busy?'disabled':''} />
      ${image(item)?`<img src="${esc(image(item))}" alt="${esc(item.title)}" loading="lazy" />`:'<div class="fr-empty">Image unavailable</div>'}
      <div class="fr-body"><span class="fr-small">${esc(item.marketplace)} · ${esc(item.asin)} · Flying Research</span><h3>${esc(item.title)}</h3>
      <div class="fr-data"><span>BSR<b>${fmt(item.bsr)}</b></span><span>30d trend<b>${item.improvementPercent===null?'—':`${esc(item.improvementPercent)}%`}</b></span><span>Est. sales / 30d<b>${fmt(item.estimatedSales30)}</b></span><span>Price<b>${esc(item.price || '—')}</b></span><span>Rating / reviews<b>${fmt(item.rating)} / ${fmt(item.reviewCount)}</b></span><span>Published<b>${esc(item.dateFirstAvailable || '—')}</b></span></div>
      <div class="fr-actions"><button data-action="detail" ${busy?'disabled':''}>Analyze</button><button data-action="amazon" ${busy?'disabled':''}>Amazon</button><button data-action="save" ${busy?'disabled':''}>${item.saved?'Saved ✓':'Save'}</button><button data-action="workflow" ${busy?'disabled':''}>Send to Workflow</button><button data-action="automation" ${busy?'disabled':''}>Send to Automations</button></div></div></article>`).join('') : '<div class="fr-empty">No imported designs match these filters.</div>';
  }
  async function loadTool() {
    if (['best','trends','archive','favorites'].includes(tool) || (tool === 'live' && byId('frQuery').value.trim())) {
      await accept(await api.search({tool,query:byId('frQuery').value,marketplace:byId('frMarketplace').value,productType:byId('frProduct').value}));
    } else if (tool === 'deleted') {
      await api.open(tool); await accept(await api.capture());
    } else {
      await api.open(tool);
      notice(tool === 'live' ? 'Enter a keyword, then Search Flying for live results.' : `${tools[tool].label} is open in Flying. Run its analysis there; import designs when a results list is available.`);
    }
  }
  async function accept(result) {
    items = result.items || []; selected.clear(); savedOnly = false; loadedOnce = true;
    notice(`${result.count} designs imported from Flying Research. ${new Date(result.capturedAt).toLocaleString()}${result.skippedItems?.length ? `\n${result.skippedItems.length} rows skipped because their identity was incomplete.` : ''}`);
  }
  async function sendWorkflow(key) {
    if (document.getElementById('uwStart')?.disabled) throw new Error('Workflow is busy. Wait for the active workflow before sending another design.');
    const result = await api.workflow(key);
    const reference = document.getElementById('uwReferencePath'), source = document.getElementById('uwSourceUrl');
    if (!reference || !source) throw new Error('Workflow inputs are unavailable.');
    reference.value = result.referencePath; source.value = result.sourceUrl;
    reference.dispatchEvent(new Event('change',{bubbles:true})); source.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('.nav[data-view="create"]')?.click();
    notice(`${result.title} is ready in Workflow. Press Start when ready.`);
  }
  async function sendAutomation(keys) {
    const result = await api.addToAutomation({ keys, newChat: localStorage.getItem('zeropod.automation.startNewChat') === '1' });
    for (const row of result.rows) selected.delete(row.researchKey);
    notice(`${result.added} designs sent to Automations.${result.skippedItems.length ? '\n'+result.skippedItems.map((v)=>`${v.key}: ${v.reason}`).join('\n') : ''}`, !result.added);
    if (typeof refreshAutomationListV2 === 'function') await refreshAutomationListV2();
    if (result.added) {
      const button = document.createElement('button'); button.textContent = 'View Automations';
      button.onclick = () => document.querySelector('.nav[data-view="automation"]')?.click();
      byId('frNotice').append(document.createElement('br'),button);
    }
  }
  function detail(item) {
    const root = byId('frDetail'); root.hidden = false;
    root.innerHTML = `<div class="heading-row"><h3>${esc(item.title)}</h3><button id="frCloseDetail">Close</button></div><p>${esc(item.trendDescription || '30-day trend unavailable')}</p><p class="fr-small">Captured ${esc(new Date(item.capturedAt).toLocaleString())} · ${esc(item.brand || '')}</p><ul>${(item.bulletpoints || []).map((v)=>`<li>${esc(v)}</li>`).join('')}</ul><p class="fr-small">Source: ${esc(item.sourceUrl)}</p><button id="frNativeDetail">Open Flying Analysis</button>`;
    byId('frCloseDetail').onclick = () => { root.hidden = true; };
    byId('frNativeDetail').onclick = () => action(() => api.open('best'), 'Opening Flying analysis tools…');
    root.scrollIntoView({block:'nearest'});
  }
  byId('frResults').addEventListener('change', (event) => {
    const key = event.target.dataset.select; if (!key || busy) return;
    event.target.checked ? selected.add(key) : selected.delete(key); render();
  });
  byId('frResults').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const item = items.find((v)=>v.key === button.closest('[data-key]').dataset.key); if (!item) return;
    const kind = button.dataset.action;
    if (kind === 'detail') return detail(item);
    action(async () => {
      if (kind === 'workflow') await sendWorkflow(item.key);
      if (kind === 'automation') await sendAutomation([item.key]);
      if (kind === 'amazon') await api.openAmazon(item.key);
      if (kind === 'save') { await api.save({key:item.key,saved:!item.saved}); await load(); }
    });
  });
  byId('frLogin').onclick = () => action(async()=>{ await api.login(); notice('Finish signing in in the dedicated Chrome window, then return and click Test Session.'); });
  byId('frTest').onclick = () => action(async()=>{ const result=await api.test(); byId('frSession').textContent=result.status==='verified'?'Connected':result.status; notice(result.message,result.status!=='verified'); if (result.status === 'verified' && !loadedOnce) await loadTool(); });
  byId('frOpen').onclick = () => action(async()=>{ await api.open(tool); notice('Flying Tools is open. Set filters or use analysis tools, then Import Current Results.'); });
  byId('frCapture').onclick = () => action(async()=>accept(await api.capture()), 'Importing the currently loaded Flying designs…');
  byId('frSearch').onclick = () => action(async()=>{ await accept(await api.search({tool,query:byId('frQuery').value,marketplace:byId('frMarketplace').value,productType:byId('frProduct').value})); }, 'Searching Flying Research…');
  byId('frLoad').onclick = () => action(async()=>{ savedOnly=false; await load(); notice('Showing previously imported Flying designs.'); });
  byId('frSaved').onclick = () => { savedOnly=!savedOnly; load().catch(showError); };
  byId('frGrid').onclick = () => { view='grid';localStorage.setItem('zeropod.flying.view',view);render(); };
  byId('frList').onclick = () => { view='list';localStorage.setItem('zeropod.flying.view',view);render(); };
  byId('frSelectAll').onchange = (event) => { for(const item of filtered()) event.target.checked?selected.add(item.key):selected.delete(item.key); render(); };
  byId('frClear').onclick = () => {selected.clear();render();};
  byId('frWorkflow').onclick = () => action(()=>sendWorkflow([...selected][0]),'Preparing matching image and URL for Workflow…');
  byId('frAutomation').onclick = () => action(()=>sendAutomation([...selected]),'Preparing selected designs for Automations…');
  for(const id of ['frFilter','frSort','frMarketplace','frHideBrands','frBsrMin','frBsrMax','frPriceMin','frPriceMax','frRating','frReviews','frFrom','frTo']) byId(id).addEventListener('input',render);
  byId('frReset').onclick = () => { for(const id of ['frFilter','frBsrMin','frBsrMax','frPriceMin','frPriceMax','frRating','frReviews','frFrom','frTo']) byId(id).value='';byId('frHideBrands').checked=true;byId('frSort').value='bsr';render(); };
  const optionsReady = api.options().then((options)=>{
    tools=options.tools;
    byId('frTools').innerHTML=Object.entries(tools).map(([key,value])=>`<button data-tool="${esc(key)}">${esc(value.label)}</button>`).join('');
    byId('frMarketplace').insertAdjacentHTML('beforeend',Object.entries(options.marketplaces).map(([key,value])=>`<option value="${esc(key)}">${esc(value.label)}</option>`).join(''));
    byId('frProduct').innerHTML=Object.entries(options.products).map(([key,value])=>`<option value="${esc(key)}">${esc(value)}</option>`).join('');
    byId('frTools').onclick=(event)=>{ const button=event.target.closest('button[data-tool]');if(!button||busy)return;tool=button.dataset.tool;items=[];selected.clear();loadedOnce=false;render();action(loadTool,`Loading ${tools[tool].label}…`); };
    render();
  }).catch(showError);
  render();
})();
