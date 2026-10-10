(() => {
  const selected = new Set();
  let items = [];
  let activeTab = 'best';
  let viewMode = localStorage.getItem('zeropod.research.view') || 'grid';
  let marketplaces = {};
  let currentDetail = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fileUrl = (filePath) => filePath ? encodeURI(`file:///${String(filePath).replace(/\\/g, '/')}`) : '';
  const money = (value) => value || 'N/A';
  const ago = (value) => {
    if (!value) return 'N/A';
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return 'N/A';
    const minutes = Math.max(0, Math.floor(ms / 60000));
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} hr ago`;
    return `${Math.floor(hours / 24)} d ago`;
  };
  const fmtDate = (value) => value ? new Date(value).toLocaleString() : 'N/A';
  const fmtRank = (value) => Number.isFinite(Number(value)) ? `#${Number(value).toLocaleString()}` : 'N/A';
  const fmtTrend = (trend) => trend && Number.isFinite(trend.improvementPercent) ? `${trend.improvementPercent >= 0 ? '↑' : '↓'} ${Math.abs(trend.improvementPercent).toFixed(0)}%` : 'N/A';
  const scoreLabel = (item) => item.winnerScore?.score === null || item.winnerScore?.score === undefined ? 'N/A' : `${item.winnerScore.score} · ${item.winnerScore.label || ''}`;

  function installStyles() {
    if (document.getElementById('researchStyles')) return;
    const style = document.createElement('style');
    style.id = 'researchStyles';
    style.textContent = `
      .rs-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.rs-tab.active{background:#6875ff;color:#fff;border-color:#6875ff}.rs-toolbar{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.rs-toolbar .wide{grid-column:span 2}.rs-toolbar-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.rs-mini{font-size:11px;color:#8f99a8}.rs-results-head{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;margin:14px 0}.rs-results-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}.rs-card{position:relative;background:#171b21;border:1px solid #2a313c;border-radius:14px;overflow:hidden;cursor:pointer;transition:.15s}.rs-card:hover{border-color:#4b5668}.rs-card.selected{border-color:#6875ff;box-shadow:0 0 0 2px rgba(104,117,255,.16)}.rs-card-check{position:absolute;top:10px;left:10px;z-index:2;width:22px;height:22px;accent-color:#6875ff}.rs-card-img{width:100%;height:230px;object-fit:contain;background:#0b0d10}.rs-card-body{padding:12px}.rs-card-title{font-weight:700;font-size:13px;line-height:1.35;min-height:36px}.rs-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:800;margin:0 5px 5px 0;background:#20262f;border:1px solid #384150}.rs-badge.best{background:#332b11;border-color:#66531b;color:#f1d462}.rs-badge.trend{background:#102b25;border-color:#1d5f50;color:#84e0c2}.rs-data{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;font-size:11px;color:#aeb7c4}.rs-data b{color:#e3e7ed}.rs-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.rs-actions button{font-size:11px;padding:6px 8px}.rs-list{display:grid;gap:8px}.rs-list .rs-card{display:grid;grid-template-columns:120px minmax(0,1fr)}.rs-list .rs-card-img{height:120px}.rs-list .rs-card-body{display:grid;grid-template-columns:minmax(200px,1fr) 2fr auto;gap:12px;align-items:center}.rs-selection{position:sticky;bottom:12px;z-index:8;margin-top:14px;background:#141923;border:1px solid #4a55a5;border-radius:12px;padding:12px;display:none;justify-content:space-between;align-items:center;gap:12px;box-shadow:0 12px 34px rgba(0,0,0,.35)}.rs-selection.visible{display:flex}.rs-selection-actions{display:flex;gap:8px}.rs-notice{margin:12px 0;padding:11px 12px;border-radius:10px;background:#101419;border:1px solid #2a313c}.rs-notice.ok{border-color:#315b45;color:#85ddb0}.rs-notice.error{border-color:#6d3038;color:#ff9ba5}.rs-detail{position:fixed;right:0;top:0;bottom:0;width:min(520px,90vw);background:#11151a;border-left:1px solid #313846;z-index:30;transform:translateX(105%);transition:.18s;padding:20px;overflow:auto;box-shadow:-18px 0 40px rgba(0,0,0,.35)}.rs-detail.open{transform:translateX(0)}.rs-detail-image{width:100%;max-height:430px;object-fit:contain;background:#080b0e;border-radius:12px}.rs-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.rs-detail-field{padding:9px;background:#171b21;border-radius:8px}.rs-detail-field b{display:block;font-size:10px;color:#8f99a8;text-transform:uppercase;margin-bottom:3px}.rs-subpanel{margin-top:14px;padding:14px;background:#171b21;border:1px solid #2a313c;border-radius:12px}.rs-manual{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.rs-manual label{flex:1;min-width:260px}.rs-empty{padding:48px;text-align:center;border:1px dashed #303744;border-radius:12px;color:#8f99a8}.rs-filter-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px}.rs-filter-row label{display:flex;gap:6px;align-items:center;font-size:12px}.rs-count{font-variant-numeric:tabular-nums}.rs-history{font-size:11px;line-height:1.55;max-height:180px;overflow:auto}.rs-history-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;border-bottom:1px solid #272e38;padding:5px 0}
      @media(max-width:980px){.rs-toolbar{grid-template-columns:1fr}.rs-toolbar .wide{grid-column:auto}.rs-list .rs-card,.rs-list .rs-card-body{grid-template-columns:1fr}.rs-list .rs-card-img{height:220px}}
    `;
    document.head.appendChild(style);
  }

  function activateResearch() {
    document.querySelectorAll('.nav').forEach((button) => button.classList.toggle('active', button.dataset.view === 'research'));
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active-view', view.id === 'research'));
    refreshResearch().catch(showError);
  }

  function build() {
    installStyles();
    const automationNav = document.querySelector('.nav[data-view="automation"]');
    if (!automationNav || document.querySelector('.nav[data-view="research"]')) return;
    const nav = document.createElement('button');
    nav.className = 'nav';
    nav.dataset.view = 'research';
    nav.textContent = 'Research';
    automationNav.insertAdjacentElement('afterend', nav);
    nav.addEventListener('click', activateResearch);

    const main = document.querySelector('main.content');
    const section = document.createElement('section');
    section.id = 'research';
    section.className = 'view';
    section.innerHTML = `
      <div class="eyebrow">ZEROPOD MARKET RESEARCH</div>
      <div class="heading-row"><div><h2>Research</h2><p class="muted">Amazon Best Sellers provenance + ZeroPOD history. Search position is never treated as Best Seller position.</p></div><div id="rsUpdated" class="queue-state">Not refreshed</div></div>
      <div class="rs-tabs"><button class="rs-tab active" data-tab="best">Best Sellers</button><button class="rs-tab" data-tab="trending">Trending</button><button class="rs-tab" data-tab="new">New Winners</button><button class="rs-tab" data-tab="saved">Saved</button></div>
      <div class="panel">
        <div class="rs-toolbar">
          <label>Marketplace<select id="rsMarketplace"></select></label>
          <label>Product<select id="rsProductType"><option value="tshirt">T-Shirt</option><option value="hoodie">Hoodie</option><option value="sweatshirt">Sweatshirt</option><option value="tank">Tank Top</option><option value="all">All POD</option></select></label>
          <label>Sort<select id="rsSort"><option value="rank">Amazon Best Seller Position</option><option value="winner">Winner Score</option><option value="bsr">Current BSR</option><option value="trend7">7-Day Trend</option><option value="newest">Newest First Seen</option><option value="reviews">Lowest Reviews</option></select></label>
          <label class="wide">Best Sellers source URL <span class="rs-mini">(optional; must be an actual Amazon Best Sellers page)</span><input id="rsSourceUrl" placeholder="Leave blank for built-in US T-Shirt source, or paste an Amazon Best Sellers category URL" /></label>
          <div class="rs-toolbar-actions"><button class="primary" id="rsRefresh">Refresh</button><button id="rsGrid">Grid</button><button id="rsList">List</button></div>
        </div>
        <div class="rs-filter-row"><label><input id="rsVerifiedOnly" type="checkbox" /> Verified Best Seller only</label><label><input id="rsLowReview" type="checkbox" /> Low-review only (≤100)</label><label><input id="rsImagesOnly" type="checkbox" checked /> Only with images</label><label>Search <input id="rsSearch" placeholder="Title / ASIN / category" style="min-width:260px" /></label><button id="rsResetFilters" class="secondary">Reset Filters</button></div>
      </div>
      <div class="rs-subpanel"><div class="heading-row"><div><h3>Add Amazon Product</h3><p class="muted">URL or ASIN. Manual import starts tracking it but does NOT mark it Verified Best Seller.</p></div></div><div class="rs-manual"><label>Amazon URL / ASIN<input id="rsManualValue" placeholder="https://www.amazon.com/dp/... or ASIN" /></label><button id="rsManualImport">Add Product</button></div></div>
      <div id="rsNotice"></div>
      <div class="rs-results-head"><div><strong class="rs-count" id="rsCount">0 designs</strong><div class="rs-mini" id="rsContext"></div></div><div class="rs-results-actions"><label><input type="checkbox" id="rsSelectAll" /> Select all visible</label><span id="rsSelectedCount">0 selected</span></div></div>
      <div id="rsResults" class="rs-grid"></div>
      <div id="rsSelection" class="rs-selection"><strong id="rsSelectionText">0 designs selected</strong><div class="rs-selection-actions"><button id="rsClearSelection">Clear Selection</button><button class="primary" id="rsAddSelected">ADD SELECTED TO AUTOMATION</button></div></div>
      <aside id="rsDetail" class="rs-detail"><div class="heading-row"><h3>Research Detail</h3><button id="rsCloseDetail">×</button></div><div id="rsDetailBody"></div></aside>`;
    main.appendChild(section);
    wire();
    loadMarketplaceOptions().catch(showError);
  }

  async function loadMarketplaceOptions() {
    marketplaces = await window.zeroPOD.research.marketplaces();
    const select = document.getElementById('rsMarketplace');
    select.innerHTML = Object.entries(marketplaces).map(([code, value]) => `<option value="${esc(code)}">${esc(value.label)}</option>`).join('');
    select.value = 'US';
  }

  function showNotice(message, kind = '') {
    const root = document.getElementById('rsNotice');
    if (!root) return;
    root.innerHTML = message ? `<div class="rs-notice ${kind}">${esc(message)}</div>` : '';
  }
  function showError(error) { showNotice(error?.message || String(error), 'error'); }

  function wire() {
    document.querySelectorAll('.rs-tab').forEach((button) => button.addEventListener('click', async () => {
      activeTab = button.dataset.tab;
      document.querySelectorAll('.rs-tab').forEach((item) => item.classList.toggle('active', item === button));
      selected.clear();
      await refreshResearch();
    }));
    document.getElementById('rsMarketplace').addEventListener('change', async () => { selected.clear(); await refreshResearch(); });
    document.getElementById('rsProductType').addEventListener('change', async () => { selected.clear(); await refreshResearch(); });
    document.getElementById('rsSearch').addEventListener('input', render);
    ['rsVerifiedOnly','rsLowReview','rsImagesOnly','rsSort'].forEach((id) => document.getElementById(id).addEventListener('change', render));
    document.getElementById('rsResetFilters').addEventListener('click', () => {
      document.getElementById('rsSearch').value = '';
      document.getElementById('rsVerifiedOnly').checked = false;
      document.getElementById('rsLowReview').checked = false;
      document.getElementById('rsImagesOnly').checked = true;
      document.getElementById('rsSort').value = 'rank';
      render();
    });
    document.getElementById('rsRefresh').addEventListener('click', refreshBestSellers);
    document.getElementById('rsManualImport').addEventListener('click', importManual);
    document.getElementById('rsGrid').addEventListener('click', () => { viewMode = 'grid'; localStorage.setItem('zeropod.research.view', viewMode); render(); });
    document.getElementById('rsList').addEventListener('click', () => { viewMode = 'list'; localStorage.setItem('zeropod.research.view', viewMode); render(); });
    document.getElementById('rsSelectAll').addEventListener('change', (event) => {
      const visible = filteredItems();
      for (const item of visible) event.target.checked ? selected.add(item.key) : selected.delete(item.key);
      render();
    });
    document.getElementById('rsClearSelection').addEventListener('click', () => { selected.clear(); render(); });
    document.getElementById('rsAddSelected').addEventListener('click', addSelected);
    document.getElementById('rsCloseDetail').addEventListener('click', () => document.getElementById('rsDetail').classList.remove('open'));
  }

  async function refreshResearch() {
    const marketplace = document.getElementById('rsMarketplace')?.value || 'US';
    const filters = { marketplace };
    if (activeTab === 'saved') filters.savedOnly = true;
    items = await window.zeroPOD.research.list(filters);
    render();
  }

  async function refreshBestSellers() {
    const button = document.getElementById('rsRefresh');
    button.disabled = true;
    showNotice('Refreshing Amazon Best Sellers through the ZeroPOD browser…');
    try {
      const marketplace = document.getElementById('rsMarketplace').value;
      const productType = document.getElementById('rsProductType').value;
      const sourceUrl = document.getElementById('rsSourceUrl').value.trim() || null;
      const result = await window.zeroPOD.research.refreshBestSellers({ marketplace, productType, sourceUrl });
      items = await window.zeroPOD.research.list({ marketplace });
      document.getElementById('rsUpdated').textContent = `Updated ${new Date(result.verifiedAt).toLocaleTimeString()}`;
      document.getElementById('rsContext').textContent = `${result.count} verified from ${result.category || 'Amazon Best Sellers'}`;
      showNotice(`${result.count} products verified directly from the Amazon Best Sellers page.`, 'ok');
      render();
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  }

  async function importManual() {
    const value = document.getElementById('rsManualValue').value.trim();
    if (!value) return showNotice('Enter an Amazon URL or ASIN first.', 'error');
    const button = document.getElementById('rsManualImport');
    button.disabled = true;
    showNotice('Reading the Amazon product page…');
    try {
      const item = await window.zeroPOD.research.importProduct({ value, marketplace: document.getElementById('rsMarketplace').value });
      document.getElementById('rsManualValue').value = '';
      await refreshResearch();
      showNotice(`${item.asin} added to Research. It is tracked as ${item.verifiedBestSeller ? 'Verified Best Seller' : item.bsr ? 'Ranked Seller' : 'Research item'}; manual import does not invent Best Seller status.`, 'ok');
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  }

  function filteredItems() {
    const productType = document.getElementById('rsProductType')?.value || 'all';
    const q = (document.getElementById('rsSearch')?.value || '').trim().toLowerCase();
    const verifiedOnly = Boolean(document.getElementById('rsVerifiedOnly')?.checked);
    const lowReview = Boolean(document.getElementById('rsLowReview')?.checked);
    const imagesOnly = Boolean(document.getElementById('rsImagesOnly')?.checked);
    let list = [...items];
    if (activeTab === 'trending') list = list.filter((item) => Number(item.trend7?.improvementPercent || 0) > 0 || Number(item.trend30?.improvementPercent || 0) > 0);
    if (activeTab === 'new') list = list.filter((item) => {
      const age = item.firstSeenAt ? (Date.now() - new Date(item.firstSeenAt).getTime()) / 86400000 : Infinity;
      return age <= 90 && (item.verifiedBestSeller || Number.isFinite(Number(item.bsr))) && (item.reviewCount === null || item.reviewCount === undefined || Number(item.reviewCount) <= 150) && (Number(item.trend7?.improvementPercent || 0) > 0 || (item.winnerScore?.score || 0) >= 70);
    });
    if (productType !== 'all') list = list.filter((item) => item.productType === productType);
    if (verifiedOnly) list = list.filter((item) => item.verifiedBestSeller);
    if (lowReview) list = list.filter((item) => item.reviewCount === null || item.reviewCount === undefined || Number(item.reviewCount) <= 100);
    if (imagesOnly) list = list.filter((item) => item.cachedImagePath || item.imageUrl);
    if (q) list = list.filter((item) => [item.title,item.asin,item.bestSellerCategory,item.bsrCategory,item.category].some((value) => String(value || '').toLowerCase().includes(q)));

    const sort = document.getElementById('rsSort')?.value || 'rank';
    const num = (value, fallback = Number.MAX_SAFE_INTEGER) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    if (sort === 'winner') list.sort((a,b) => num(b.winnerScore?.score, -1) - num(a.winnerScore?.score, -1));
    else if (sort === 'bsr') list.sort((a,b) => num(a.bsr) - num(b.bsr));
    else if (sort === 'trend7') list.sort((a,b) => num(b.trend7?.improvementPercent, -Infinity) - num(a.trend7?.improvementPercent, -Infinity));
    else if (sort === 'newest') list.sort((a,b) => new Date(b.firstSeenAt || 0) - new Date(a.firstSeenAt || 0));
    else if (sort === 'reviews') list.sort((a,b) => num(a.reviewCount) - num(b.reviewCount));
    else list.sort((a,b) => num(a.bestSellerPosition) - num(b.bestSellerPosition));
    return list;
  }

  function badgeHtml(item) {
    const out = [];
    if (item.verifiedBestSeller && Number.isFinite(Number(item.bestSellerPosition))) out.push(`<span class="rs-badge best">🏆 AMAZON ${esc(fmtRank(item.bestSellerPosition))}</span>`);
    else if (Number.isFinite(Number(item.bsr))) out.push('<span class="rs-badge">📊 RANKED SELLER</span>');
    if (Number(item.trend7?.improvementPercent || 0) > 0) out.push('<span class="rs-badge trend">🚀 ZEROPOD TRENDING</span>');
    return out.join('');
  }

  function imageSrc(item) { return item.cachedImagePath ? fileUrl(item.cachedImagePath) : (item.imageUrl || ''); }

  function cardHtml(item) {
    const checked = selected.has(item.key);
    return `<article class="rs-card ${checked ? 'selected' : ''}" data-key="${esc(item.key)}">
      <input class="rs-card-check" type="checkbox" data-key="${esc(item.key)}" ${checked ? 'checked' : ''} aria-label="Select ${esc(item.title || item.asin)}" />
      ${imageSrc(item) ? `<img class="rs-card-img" src="${esc(imageSrc(item))}" alt="${esc(item.title || item.asin)}" />` : '<div class="rs-card-img rs-empty">No image</div>'}
      <div class="rs-card-body">
        <div><div>${badgeHtml(item)}</div><div class="rs-card-title">${esc(item.title || item.asin)}</div><div class="rs-mini">${esc(item.bestSellerCategory || item.bsrCategory || item.category || 'Category N/A')}</div></div>
        <div class="rs-data"><span>BSR <b>${esc(fmtRank(item.bsr))}</b></span><span>7d <b>${esc(fmtTrend(item.trend7))}</b></span><span>Price <b>${esc(money(item.price))}</b></span><span>Reviews <b>${esc(item.reviewCount ?? 'N/A')}</b></span><span>Score <b>${esc(scoreLabel(item))}</b></span><span>Verified <b>${esc(ago(item.lastVerifiedAt))}</b></span></div>
        <div class="rs-actions"><button data-action="amazon" data-key="${esc(item.key)}">Amazon</button><button data-action="detail" data-key="${esc(item.key)}">Analyze</button><button data-action="save" data-key="${esc(item.key)}">${item.saved ? 'Saved ✓' : 'Save'}</button></div>
      </div>
    </article>`;
  }

  function render() {
    const visible = filteredItems();
    const root = document.getElementById('rsResults');
    if (!root) return;
    root.className = viewMode === 'list' ? 'rs-list' : 'rs-grid';
    root.innerHTML = visible.length ? visible.map(cardHtml).join('') : '<div class="rs-empty">No research items match this view yet. Refresh Best Sellers or add an Amazon product.</div>';
    document.getElementById('rsCount').textContent = `${visible.length} design${visible.length === 1 ? '' : 's'}`;
    document.getElementById('rsSelectedCount').textContent = `${selected.size} selected`;
    document.getElementById('rsSelectionText').textContent = `${selected.size} design${selected.size === 1 ? '' : 's'} selected`;
    document.getElementById('rsSelection').classList.toggle('visible', selected.size > 0);
    const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.key));
    const selectAll = document.getElementById('rsSelectAll');
    selectAll.checked = allVisibleSelected;
    selectAll.indeterminate = !allVisibleSelected && visible.some((item) => selected.has(item.key));
    document.getElementById('rsGrid').disabled = viewMode === 'grid';
    document.getElementById('rsList').disabled = viewMode === 'list';

    root.querySelectorAll('.rs-card-check').forEach((input) => input.addEventListener('click', (event) => {
      event.stopPropagation();
      input.checked ? selected.add(input.dataset.key) : selected.delete(input.dataset.key);
      render();
    }));
    root.querySelectorAll('.rs-card').forEach((card) => card.addEventListener('click', (event) => {
      if (event.target.closest('button,input')) return;
      openDetail(card.dataset.key);
    }));
    root.querySelectorAll('[data-action="detail"]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); openDetail(button.dataset.key); }));
    root.querySelectorAll('[data-action="amazon"]').forEach((button) => button.addEventListener('click', async (event) => { event.stopPropagation(); const item = items.find((x) => x.key === button.dataset.key); if (item) await window.zeroPOD.research.openAmazon(item.canonicalUrl); }));
    root.querySelectorAll('[data-action="save"]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const item = items.find((x) => x.key === button.dataset.key); if (!item) return;
      await window.zeroPOD.research.save({ key: item.key, saved: !item.saved });
      await refreshResearch();
    }));
  }

  async function openDetail(key) {
    const item = await window.zeroPOD.research.get(key);
    if (!item) return;
    currentDetail = item;
    const history = Array.isArray(item.history) ? item.history : [];
    const fields = [
      ['ASIN', item.asin], ['Marketplace', item.marketplace], ['Product Type', item.productType || 'N/A'], ['Amazon URL', item.canonicalUrl],
      ['Best Seller', item.verifiedBestSeller ? `Verified ${fmtRank(item.bestSellerPosition)}` : 'Not verified'], ['Best Seller Category', item.bestSellerCategory || 'N/A'],
      ['Current BSR', fmtRank(item.bsr)], ['BSR Category', item.bsrCategory || 'N/A'], ['Price', item.price || 'N/A'], ['Rating', item.rating ?? 'N/A'],
      ['Reviews', item.reviewCount ?? 'N/A'], ['Date First Available', item.dateFirstAvailable || 'N/A'], ['First Seen', fmtDate(item.firstSeenAt)], ['Last Checked', fmtDate(item.lastCheckedAt)],
      ['Winner Score', scoreLabel(item)], ['Source', item.source || 'N/A']
    ];
    document.getElementById('rsDetailBody').innerHTML = `
      ${imageSrc(item) ? `<img class="rs-detail-image" src="${esc(imageSrc(item))}" alt="${esc(item.title || item.asin)}" />` : ''}
      <h3>${esc(item.title || item.asin)}</h3><div>${badgeHtml(item)}</div>
      <div class="rs-detail-grid">${fields.map(([label,value]) => `<div class="rs-detail-field"><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('')}</div>
      <div class="rs-subpanel"><strong>History</strong><div class="rs-history">${history.length ? history.slice().reverse().map((h) => `<div class="rs-history-row"><span>${esc(new Date(h.at).toLocaleDateString())}</span><span>Amazon ${esc(fmtRank(h.bestSellerPosition))}</span><span>BSR ${esc(fmtRank(h.bsr))}</span></div>`).join('') : '<div class="rs-mini">No historical change snapshots yet.</div>'}</div></div>
      <div class="rs-review-actions" style="margin-top:14px"><button id="rsDetailAmazon">OPEN ON AMAZON</button><button id="rsDetailSave">${item.saved ? 'SAVED ✓' : 'SAVE'}</button><button class="primary" id="rsDetailAdd">ADD TO AUTOMATION</button></div>`;
    document.getElementById('rsDetail').classList.add('open');
    document.getElementById('rsDetailAmazon').onclick = () => window.zeroPOD.research.openAmazon(item.canonicalUrl);
    document.getElementById('rsDetailSave').onclick = async () => { await window.zeroPOD.research.save({ key: item.key, saved: !item.saved }); await refreshResearch(); document.getElementById('rsDetail').classList.remove('open'); };
    document.getElementById('rsDetailAdd').onclick = async () => { selected.clear(); selected.add(item.key); await addSelected(); };
  }

  async function addSelected() {
    if (!selected.size) return;
    const button = document.getElementById('rsAddSelected');
    button.disabled = true;
    showNotice(`Adding ${selected.size} selected design${selected.size === 1 ? '' : 's'} to the existing Automation List…`);
    try {
      const result = await window.zeroPOD.research.addToAutomation([...selected]);
      const addedKeys = new Set((result.rows || []).map((row) => row.researchKey));
      for (const key of addedKeys) selected.delete(key);
      const suffix = result.skipped ? ` ${result.skipped} skipped (${(result.skippedItems || []).map((item) => item.reason).join('; ')}).` : '';
      showNotice(`${result.added} design${result.added === 1 ? '' : 's'} added to Automation List.${suffix}`, result.added ? 'ok' : 'error');
      render();
      const notice = document.getElementById('rsNotice').firstElementChild;
      if (result.added && notice) {
        const actions = document.createElement('div');
        actions.className = 'rs-actions';
        actions.innerHTML = '<button id="rsViewAutomation">View Automation List</button><button id="rsContinueResearch">Continue Research</button>';
        notice.appendChild(actions);
        document.getElementById('rsViewAutomation').onclick = () => document.querySelector('.nav[data-view="automation"]')?.click();
        document.getElementById('rsContinueResearch').onclick = () => showNotice('');
      }
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  }

  build();
})();
