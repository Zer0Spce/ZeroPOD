const { app } = require('electron');

function rendererImageCheckDockInjection() {
  if (window.__zeroPodImageCheckDockInstalled) return;
  window.__zeroPodImageCheckDockInstalled = true;

  const ensureStyles = () => {
    if (document.getElementById('zeroPodImageCheckDockStyles')) return;
    const style = document.createElement('style');
    style.id = 'zeroPodImageCheckDockStyles';
    style.textContent = `
      #uwRightRail.uw-right-rail{
        display:flex;
        flex-direction:column;
        gap:12px;
        align-self:start;
        position:sticky;
        top:12px;
        min-width:0;
      }
      #uwRightRail.uw-right-rail > .uw-panel{margin-bottom:0}
      #uwRightRail #uwLog{height:170px}
      #uwRightRail #uwImageReview,
      #uwRightRail #uwFinalReview,
      #uwRightRail #uwPublished{
        padding:14px;
        margin:0;
        min-width:0;
        max-height:calc(100vh - 395px);
        overflow:auto;
      }
      #uwRightRail #uwImageReview.visible{
        display:flex;
        flex-direction:column;
      }
      #uwRightRail #uwFinalReview.visible,
      #uwRightRail #uwPublished.visible{
        display:block;
      }
      #uwRightRail #uwImageReview h3,
      #uwRightRail #uwFinalReview h3,
      #uwRightRail #uwPublished h3{margin-bottom:5px}
      #uwRightRail #uwImageReview p,
      #uwRightRail #uwFinalReview p,
      #uwRightRail #uwPublished p{
        margin:0 0 8px;
        font-size:12px;
        line-height:1.35;
      }
      #uwRightRail #uwImageReview .uw-review-image{
        width:100%;
        max-height:230px;
        object-fit:contain;
      }
      #uwRightRail #uwImageReview label{
        margin-top:8px !important;
        font-size:12px;
      }
      #uwRightRail #uwImageReview textarea{
        min-height:52px;
        height:52px;
        max-height:80px;
        resize:vertical;
      }
      #uwRightRail #uwImageReview .uw-review-actions,
      #uwRightRail #uwFinalReview .uw-review-actions{
        margin-top:8px;
        gap:7px;
      }
      #uwRightRail #uwImageReview .uw-review-actions button,
      #uwRightRail #uwFinalReview .uw-review-actions button{
        flex:1 1 0;
        min-width:0;
        padding-left:9px;
        padding-right:9px;
      }
      #uwRightRail #uwFinalReview .uw-final-grid,
      #uwRightRail #uwPublished .uw-published-grid{
        grid-template-columns:1fr;
        gap:10px;
      }
      #uwRightRail #uwFinalReview .uw-shirt,
      #uwRightRail #uwPublished .uw-published-preview{
        width:100%;
        max-height:235px;
        object-fit:contain;
      }
      #uwRightRail #uwFinalReview .uw-meta{gap:7px}
      #uwRightRail #uwFinalReview .uw-meta-row,
      #uwRightRail #uwPublished .uw-meta-row{
        padding:8px 10px;
        font-size:12px;
      }
      #uwRightRail #uwPublished .uw-published-link{margin-top:8px}
      @media(max-height:820px) and (min-width:1051px){
        #uwRightRail #uwLog{height:125px}
        #uwRightRail #uwImageReview,
        #uwRightRail #uwFinalReview,
        #uwRightRail #uwPublished{max-height:calc(100vh - 330px)}
        #uwRightRail #uwImageReview .uw-review-image{max-height:175px}
        #uwRightRail #uwFinalReview .uw-shirt,
        #uwRightRail #uwPublished .uw-published-preview{max-height:170px}
        #uwRightRail #uwImageReview textarea{min-height:42px;height:42px}
      }
      @media(max-width:1050px){
        #uwRightRail.uw-right-rail{position:static;gap:16px}
        #uwRightRail #uwLog{height:250px}
        #uwRightRail #uwImageReview,
        #uwRightRail #uwFinalReview,
        #uwRightRail #uwPublished{max-height:none;overflow:visible}
        #uwRightRail #uwImageReview .uw-review-image{max-height:610px}
        #uwRightRail #uwFinalReview .uw-shirt,
        #uwRightRail #uwPublished .uw-published-preview{max-height:460px}
      }
    `;
    document.head.appendChild(style);
  };

  const wireStartLogClear = () => {
    const startButton = document.getElementById('uwStart');
    if (!startButton || startButton.dataset.zeropodClearLogWired === '1') return;
    startButton.dataset.zeropodClearLogWired = '1';
    // Capture phase guarantees the previous run is cleared before unifiedWorkflow
    // writes the first "Starting workflow" line for the new job.
    startButton.addEventListener('click', () => {
      const log = document.getElementById('uwLog');
      if (log) log.innerHTML = '';
    }, true);
  };

  const dock = () => {
    ensureStyles();
    const grid = document.querySelector('#create .uw-grid');
    const imageReview = document.getElementById('uwImageReview');
    const finalReview = document.getElementById('uwFinalReview');
    const published = document.getElementById('uwPublished');
    if (!grid || !imageReview || !finalReview || !published) return false;

    let rail = document.getElementById('uwRightRail');
    if (!rail) {
      const logPanel = [...grid.children].find((child) => child.querySelector?.('#uwLog'));
      if (!logPanel) return false;
      rail = document.createElement('div');
      rail.id = 'uwRightRail';
      rail.className = 'uw-right-rail';
      grid.replaceChild(rail, logPanel);
      rail.appendChild(logPanel);
    }

    imageReview.classList.add('uw-side-review');
    finalReview.classList.add('uw-side-review');
    published.classList.add('uw-side-review');

    // These three cards are mutually exclusive in unifiedWorkflow.js, so whichever
    // check/result is active occupies the same right-side slot below the live log.
    for (const panel of [imageReview, finalReview, published]) {
      if (panel.parentElement !== rail) rail.appendChild(panel);
    }

    wireStartLogClear();
    return true;
  };

  let attempts = 0;
  const boot = () => {
    if (dock()) return;
    attempts += 1;
    if (attempts < 40) setTimeout(boot, 100);
  };
  boot();

  const root = document.getElementById('create');
  if (root) {
    const observer = new MutationObserver(() => dock());
    observer.observe(root, { childList: true, subtree: true });
  }
}

const injection = `(${rendererImageCheckDockInjection.toString()})();`;

function installOnWindow(win) {
  const inject = () => {
    if (!win || win.isDestroyed()) return;
    const url = win.webContents.getURL();
    if (!/^file:/i.test(url)) return;
    win.webContents.executeJavaScript(injection, true).catch(() => {});
  };
  win.webContents.on('did-finish-load', inject);
}

app.on('browser-window-created', (_event, win) => installOnWindow(win));

module.exports = { injection };
