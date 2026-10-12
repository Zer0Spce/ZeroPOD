const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-flying-test-'));
  const originalLoad = Module._load;
  Module._load = function(request, ...args) {
    if (request === 'electron') return { app: { getPath: () => root }, safeStorage: {} };
    return originalLoad.call(this, request, ...args);
  };
  try {
    const { readFlyingListCards, isFlyingResultsReady } = require('../src/main/flyingResearchDom');
    const { FlyingResearchFeature, normalizeFlyingCard } = require('../src/main/flyingResearchFeature');
    const { AutomationQueueStore } = require('../src/main/automationQueueStore');
    const { ResearchStore } = require('../src/main/researchStore');
    const dom = new JSDOM(`<button id="product">T-Shirt</button>
      <div class="list-card-content"><h4 class="list-card-title">Funny Dog T-Shirt</h4><div class="list-card-title-block">Funny Dog T-Shirt by: Generic Designs</div>
        <div class="asin-info">ASIN : B0CK53MMJQ</div><img alt="Marketplace flag" src="assets/country-flags/1x1/fr.svg">
        <div class="list-card-design" style='background-image:url("https://m.media-amazon.com/images/I/example.png")'></div>
        <div class="list-card-metric"><span class="list-card-metric-label"><b>BSR</b></span><span class="list-card-metric-value"><span class="list-card-bsr-status" aria-label="30-day BSR improved by 95.6%: 18,751 to 1,720.">1,720</span></span></div>
        <div class="list-card-metric"><span class="list-card-metric-label"><b>Sales</b></span><span class="list-card-metric-value">95</span></div>
        <div class="list-card-metric"><span class="list-card-metric-label"><i class="fa-euro-sign"></i><b>Price</b></span><span class="list-card-metric-value">16.99</span></div>
        <ngb-rating aria-valuenow="4.5"></ngb-rating><span class="list-card-review-count">21 review(s)</span><div class="asin-update-icon-size"><span>Sep 29, 2023</span></div>
        <ul class="list-card-description"><li>Dog lovers gift idea.</li></ul></div>
      <div class="list-card-content"><h4 class="list-card-title">Funny Cat T-Shirt</h4><div class="asin-info">ASIN : B0HF9KQR1C</div><img alt="Marketplace flag" src="assets/country-flags/1x1/gb.svg"><span class="list-card-review-count">0 review(s)</span></div>`);
    global.document = dom.window.document;
    global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    dom.window.Element.prototype.getClientRects = () => [{ width: 100, height: 50 }];
    const loading = dom.window.document.createElement('span');
    loading.className = 'research-results-loading'; loading.setAttribute('role', 'status');
    loading.textContent = 'Loading more...'; loading.setAttribute('aria-hidden', 'true');
    dom.window.document.body.append(loading);
    assert.equal(isFlyingResultsReady(), true, 'Retained aria-hidden loading node must not block loaded cards');
    loading.setAttribute('aria-hidden', 'false');
    assert.equal(isFlyingResultsReady(), false, 'Active visible loading must still block stale results');
    loading.style.visibility = 'hidden';
    assert.equal(isFlyingResultsReady(), true, 'CSS-hidden loading must not block results');
    const cardsMarkup = dom.window.document.body.innerHTML;
    dom.window.document.body.innerHTML = '<strong>0 designs</strong>';
    assert.equal(isFlyingResultsReady(), true, 'Explicit empty search must finish normally');
    dom.window.document.body.innerHTML = '<button>Copy all ASINs</button>';
    assert.equal(isFlyingResultsReady(), false, 'Toolbar without loaded results must not be ready');
    dom.window.document.body.innerHTML = cardsMarkup;
    const cards = readFlyingListCards();
    delete global.document;
    delete global.getComputedStyle;
    assert.equal(cards.length, 2);
    assert.equal(cards[0].bsr, 1720);
    assert.equal(cards[0].estimatedSales30, 95);
    assert.equal(cards[0].imageUrl, 'https://m.media-amazon.com/images/I/example.png');
    assert.equal(cards[0].priceValue, 16.99);
    assert.equal(cards[1].marketplace, 'UK');
    assert.equal(cards[1].bsr, null);
    assert.equal(cards[1].reviewCount, 0);
    const item = normalizeFlyingCard(cards[0], 'https://app.flyingresearch.net/#/research/research/best-sellers');
    assert.equal(item.canonicalUrl, 'https://www.amazon.fr/dp/B0CK53MMJQ');
    assert.equal(item.verifiedBestSeller, false);
    assert.equal(item.improvementPercent, 95.6);
    assert.equal(normalizeFlyingCard({...cards[0], marketplace:null}, item.sourceUrl), null);
    assert.equal(normalizeFlyingCard({...cards[0], imageUrl:'https://evil.example/reference.png'}, item.sourceUrl).imageUrl, null);
    assert.equal(normalizeFlyingCard({...cards[0], title:'Disney Mickey Mouse T-Shirt'}, item.sourceUrl).trademarkRisk, true);

    const feature = new FlyingResearchFeature({ sessions:{}, automationStore:new AutomationQueueStore(), projects:{findBySourceUrl:()=>[]} });
    assert.notEqual(feature.store.getRoot(), new ResearchStore().getRoot());
    const imagePath = path.join(root, 'reference.png');
    fs.writeFileSync(imagePath, Buffer.from('matching-original-image'));
    const first = feature.store.upsert({...item,cachedImagePath:imagePath});
    const second = feature.store.upsert({...item, asin:'B0HF9KQR1C', canonicalUrl:'https://www.amazon.fr/dp/B0HF9KQR1C', title:'Funny Cat T-Shirt', cachedImagePath:imagePath});
    const transfer = await feature.workflow(first.key);
    assert.equal(transfer.sourceUrl, first.canonicalUrl);
    assert.notEqual(transfer.referencePath, imagePath);
    assert.deepEqual(fs.readFileSync(transfer.referencePath),fs.readFileSync(imagePath));
    const bulk = await feature.addToAutomation({keys:[first.key,first.key,second.key],newChat:true});
    assert.equal(bulk.added,2);
    assert.equal(feature.automationStore.read().rows.length,2);
    assert.equal(feature.automationStore.read().rows[0].newChat,true);
    for (const row of feature.automationStore.read().rows) assert.deepEqual(fs.readFileSync(row.referenceImage),fs.readFileSync(imagePath));
    assert.equal((await feature.addToAutomation({keys:[first.key]})).added,0);
    fs.rmSync(imagePath);
    assert(fs.existsSync(transfer.referencePath));
    assert(fs.existsSync(feature.automationStore.read().rows[0].referenceImage));
    for(let i=0;i<13;i++) feature.automationStore.addRows([{amazonLink:`https://example.invalid/${i}`}]);
    const third=feature.store.upsert({...item,asin:'B0HHXFQ7LC',canonicalUrl:'https://www.amazon.fr/dp/B0HHXFQ7LC',cachedImagePath:transfer.referencePath});
    const full=await feature.addToAutomation({keys:[third.key]});
    assert.equal(full.added,0);
    assert.match(full.skippedItems[0].reason,/full/);
    assert.equal(feature.automationStore.read().rows.length,15);
    const branded=feature.store.upsert({...third,title:'Disney Mickey Mouse T-Shirt',asin:'B000000001'});
    await assert.rejects(feature.workflow(branded.key),/brand\/licensed/);

    // Renderer behavior: multiple selection, exact image/URL routing, no auto-start,
    // mixed success retains skipped selections, and dynamic-tab isolation.
    const ui = new JSDOM(`<button class="nav active" data-view="dashboard">Dashboard</button><button class="nav" data-view="automation">Automation</button><button class="nav" data-view="create">Workflow</button><main class="content"><section class="view active-view" id="dashboard"></section><section class="view" id="create"><input id="uwReferencePath"><input id="uwSourceUrl"><button id="uwStart">Start</button></section></main>`,{url:'https://zeropod.test/',runScripts:'outside-only'});
    const w=ui.window;
    let requestedKeys=null, requestedNewChat=null, generations=0, searches=[];
    const uiItems=[first,second].map((v)=>({...v,trademarkRisk:false}));
    w.zeroPOD={generation:{start:()=>{generations++;}},flyingResearch:{
      options:async()=>({tools:{best:{label:'Best Sellers'},trends:{label:'Seller Trends'}},marketplaces:{FR:{label:'France'}},products:{tshirt:'T-Shirt'}}),
      list:async()=>{throw Error('Initial tab must load live results automatically');},
      search:async(payload)=>{searches.push(payload);return {items:uiItems,count:uiItems.length,capturedAt:new Date().toISOString(),skippedItems:[]};},
      workflow:async(key)=>({referencePath:`C:/protected/${key}.png`,sourceUrl:uiItems.find(v=>v.key===key).canonicalUrl,title:'Ready'}),
      addToAutomation:async({keys,newChat})=>{requestedKeys=keys;requestedNewChat=newChat;return {added:1,rows:[{researchKey:keys[0]}],skippedItems:[{key:keys[1],reason:'Queue full'}]};}
    }};
    w.eval(fs.readFileSync(path.join(__dirname,'../src/renderer/flyingResearch.js'),'utf8'));
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    await tick();
    w.document.querySelector('.nav[data-view="flyingResearch"]').click();await tick();
    assert.equal(w.document.querySelectorAll('.fr-card').length,2);
    assert.equal(searches.length,1);assert.equal(searches[0].tool,'best');
    w.document.querySelector('[data-tool=trends]').click();await tick();await tick();
    assert.equal(searches.length,2);assert.equal(searches[1].tool,'trends');
    assert.equal(w.document.querySelectorAll('.fr-card').length,2);
    const all=w.document.getElementById('frSelectAll');all.checked=true;all.dispatchEvent(new w.Event('change'));
    assert.equal(w.document.getElementById('frWorkflow').disabled,true);
    assert.equal(w.document.getElementById('frSelected').textContent,'2 selected');
    w.localStorage.setItem('zeropod.automation.startNewChat','1');
    w.document.getElementById('frAutomation').click();await tick();await tick();
    assert.equal(requestedKeys.length,2);assert.equal(requestedNewChat,true);
    assert.equal(w.document.getElementById('frSelected').textContent,'1 selected');
    assert.match(w.document.getElementById('frNotice').textContent,/Queue full/);
    w.document.getElementById('frWorkflow').click();await tick();await tick();
    assert.equal(w.document.getElementById('uwSourceUrl').value,second.canonicalUrl);
    assert.match(w.document.getElementById('uwReferencePath').value,/FR:B0HF9KQR1C/);
    assert.equal(generations,0);
    assert.equal(w.document.getElementById('flyingResearch').classList.contains('active-view'),false);
    w.document.querySelector('.nav[data-view="flyingResearch"]').click();
    w.document.querySelector('.nav[data-view="dashboard"]').click();
    assert.equal(w.document.getElementById('flyingResearch').classList.contains('active-view'),false);
    ui.window.close();dom.window.close();
    console.log('Flying Research smoke passed: rendered identity extraction, protected image transfers, duplicate/capacity/brand checks, multi-select, new-chat preference, skipped rows, and tab isolation.');
  } finally {
    Module._load=originalLoad;
    delete global.document;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
