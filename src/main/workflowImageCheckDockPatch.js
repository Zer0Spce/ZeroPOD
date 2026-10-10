const { app } = require('electron');

const injection = String.raw`(() => {
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
      #uwRightRail #uwImageReview{
        padding:14px;
        margin:0;
        min-width:0;
      }
      #uwRightRail #uwImageReview.visible{
        display:flex;
        flex-direction:column;
      }
      #uwRightRail #uwImageReview h3{margin-bottom:5px}
      #uwRightRail #uwImageReview p{
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
      #uwRightRail #uwImageReview .uw-review-actions{
        margin-top:8px;
        gap:7px;
      }
      #uwRightRail #uwImageReview .uw-review-actions button{
        flex:1 1 0;
        min-width:0;
        padding-left:9px;
        padding-right:9px;
      }
      @media(max-height:820px) and (min-width:1051px){
        #uwRightRail #uwLog{height:125px}
        #uwRightRail #uwImageReview .uw-review-image{max-height:175px}
        #uwRightRail #uwImageReview textarea{min-height:42px;height:42px}
      }
      @media(max-width:1050px){
        #uwRightRail.uw-right-rail{position:static;gap:16px}
        #uwRightRail #uwLog{height:250px}
        #uwRightRail #uwImageReview .uw-review-image{max-height:610px}
      }
    `;
    document.head.appendChild(style);
  };

  const dock = () => {
    ensureStyles();
    const grid = document.querySelector('#create .uw-grid');
    const imageReview = document.getElementById('uwImageReview');
    if (!grid || !imageReview) return false;

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

    imageReview.classList.add('uw-side-image-review');
    if (imageReview.parentElement !== rail) rail.appendChild(imageReview);
    return true;
  };

  let attempts = 0;
  const boot = () => {
    if (dock()) return;
    attempts += 1;
    if (attempts < 40) setTimeout(boot, 100);
  };
  boot();

  // If the unified view is rebuilt later, put the review card back in the rail.
  const root = document.getElementById('create');
  if (root) {
    const observer = new MutationObserver(() => dock());
    observer.observe(root, { childList: true, subtree: true });
  }
})();`;

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
