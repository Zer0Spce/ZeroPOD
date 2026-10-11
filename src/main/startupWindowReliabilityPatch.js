const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function startupLogPath() {
  return path.join(app.getPath('userData'), 'startup.log');
}

function logStartup(message, details = null) {
  try {
    const file = startupLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const suffix = details === null || details === undefined
      ? ''
      : ` ${typeof details === 'string' ? details : JSON.stringify(details)}`;
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}${suffix}\n`, 'utf8');
  } catch {}
}

function fallbackHtml(message) {
  const safe = String(message || 'Unknown renderer startup failure')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const logPath = String(startupLogPath()).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>ZeroPOD Startup Recovery</title><style>
    html,body{margin:0;height:100%;font-family:Segoe UI,Arial,sans-serif;background:#0d0f12;color:#f5f7fa}
    body{display:grid;place-items:center;padding:32px}.box{max-width:760px;background:#171b21;border:1px solid #323a47;border-radius:16px;padding:24px;line-height:1.55}
    h1{margin:0 0 10px;font-size:28px}.muted{color:#a8b0bd}.path{margin-top:16px;padding:12px;background:#101419;border-radius:10px;word-break:break-all;color:#b8c1ce}
  </style></head><body><div class="box"><h1>ZeroPOD could not load the app screen</h1><p class="muted">The window started, but the renderer did not reach the dashboard. ZeroPOD stopped showing a blank window and wrote a startup diagnostic log instead.</p><p>${safe}</p><div class="path">Startup log: ${logPath}</div></div></body></html>`;
}

function attachStartupGuard(win) {
  if (!win || win.isDestroyed()) return;
  if (win.__zeroPodStartupGuard) return;
  win.__zeroPodStartupGuard = true;

  // The primary app window is created with title ZeroPOD. Do not interfere with
  // any unrelated Electron utility windows that may be added later.
  if (String(win.getTitle?.() || '') !== 'ZeroPOD') return;

  const indexPath = path.join(__dirname, '../renderer/index.html');
  let retries = 0;
  let recovered = false;
  let showingFallback = false;
  let watchdog = null;

  logStartup('Primary window created', { indexPath, packaged: app.isPackaged });
  try { win.hide(); } catch {}

  const showFallback = async (reason) => {
    if (showingFallback || win.isDestroyed()) return;
    showingFallback = true;
    recovered = true;
    logStartup('Showing startup recovery page', reason);
    const html = fallbackHtml(reason);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error) => {
      logStartup('Recovery page failed to load', error?.message || String(error));
    });
    if (!win.isDestroyed()) {
      try { win.show(); win.focus(); } catch {}
    }
  };

  const verifyRenderer = async (reason) => {
    if (recovered || showingFallback || win.isDestroyed()) return;
    let state = null;
    try {
      state = await win.webContents.executeJavaScript(`(() => {
        const shell = document.querySelector('.app-shell');
        const dashboard = document.querySelector('#dashboard');
        if (!shell || !dashboard) {
          return { ok:false, href:location.href, readyState:document.readyState, bodyLength:(document.body?.innerHTML || '').length, hasShell:Boolean(shell), hasDashboard:Boolean(dashboard) };
        }
        const style = getComputedStyle(shell);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          shell.style.display = 'grid';
          shell.style.visibility = 'visible';
          shell.style.opacity = '1';
        }
        const dashStyle = getComputedStyle(dashboard);
        if (dashStyle.display === 'none') dashboard.classList.add('active-view');
        return { ok:true, href:location.href, readyState:document.readyState, bodyLength:(document.body?.innerHTML || '').length, shellDisplay:getComputedStyle(shell).display, dashboardDisplay:getComputedStyle(dashboard).display };
      })()`);
    } catch (error) {
      state = { ok: false, error: error?.message || String(error) };
    }

    logStartup(`Renderer verification: ${reason}`, state);
    if (state?.ok) {
      recovered = true;
      if (watchdog) clearTimeout(watchdog);
      if (!win.isDestroyed()) {
        try { win.show(); win.focus(); } catch {}
      }
      return;
    }

    if (retries < 1) {
      retries += 1;
      logStartup('Reloading primary renderer after failed verification', { retries, reason });
      await win.loadFile(indexPath, { query: { startupRecovery: String(Date.now()) } }).catch((error) => {
        logStartup('Renderer reload failed', error?.message || String(error));
      });
      return;
    }

    await showFallback(`Renderer verification failed after retry (${reason}).`);
  };

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    logStartup('did-fail-load', { errorCode, errorDescription, validatedURL });
    setTimeout(() => verifyRenderer('did-fail-load'), 50);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logStartup('render-process-gone', details);
    setTimeout(() => verifyRenderer('render-process-gone'), 50);
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (Number(level) >= 2) logStartup('renderer-console', { level, message, line, sourceId });
  });

  win.webContents.on('dom-ready', () => {
    setTimeout(() => verifyRenderer('dom-ready'), 120);
  });

  watchdog = setTimeout(() => verifyRenderer('startup-watchdog'), 7000);
  setTimeout(() => {
    if (!recovered && !showingFallback) showFallback('Renderer did not become ready within 14 seconds.');
  }, 14000);
}

app.on('browser-window-created', (_event, win) => attachStartupGuard(win));

module.exports = { attachStartupGuard, startupLogPath };
