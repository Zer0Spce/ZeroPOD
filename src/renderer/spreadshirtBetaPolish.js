(() => {
  if (window.__zeroPODSpreadshirtBetaPolishInstalled) return;
  window.__zeroPODSpreadshirtBetaPolishInstalled = true;

  const AUTO_KEY = 'zeropod.spreadshirt.automateEverything.v1';
  const ACTIVE_KEY = 'zeropod.spreadshirt.alpha.activeProject';
  let autoAction = null;
  let pollTimer = null;
  let observer = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byId = (id) => document.getElementById(id);

  function appendLog(message, kind = 'warn') {
    const root = byId('ssLog');
    if (!root) return;
    const line = document.createElement('div');
    line.className = `ss-log-line ${kind}`;
    line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    root.appendChild(line);
    while (root.children.length > 220) root.removeChild(root.firstChild);
    root.scrollTop = root.scrollHeight;
  }

  function polishLabels() {
    const redbubbleNav = document.querySelector('.nav[data-view="create"]');
    if (redbubbleNav && redbubbleNav.textContent.trim() !== 'Redbubble') redbubbleNav.textContent = 'Redbubble';

    const redbubbleHeading = document.querySelector('#create h2');
    if (redbubbleHeading && redbubbleHeading.textContent.trim() === 'Workflow') redbubbleHeading.textContent = 'Redbubble';

    const spreadshirtNav = document.querySelector('.nav[data-view="spreadshirtAlpha"]');
    if (spreadshirtNav && spreadshirtNav.textContent.trim() !== 'Spreadshirt') spreadshirtNav.textContent = 'Spreadshirt';

    const spreadshirtHeading = document.querySelector('#spreadshirtAlpha h2');
    if (spreadshirtHeading && spreadshirtHeading.textContent.trim() !== 'Spreadshirt') spreadshirtHeading.textContent = 'Spreadshirt';

    document.querySelectorAll('#spreadshirtAlpha .ss-alpha-mark').forEach((node) => node.remove());
    document.querySelectorAll('#spreadshirtAlpha .ss-badge').forEach((node) => {
      if (/^alpha$/i.test(node.textContent.trim())) node.remove();
    });
  }

  function installAutomateEverythingControl() {
    if (byId('ssAutomateEverything')) return true;
    const newChat = byId('ssNewChat')?.closest('label');
    if (!newChat?.parentElement) return false;

    const option = document.createElement('label');
    option.className = 'uw-option uw-option-beta ss-automate-everything';
    option.innerHTML = `
      <input type="checkbox" id="ssAutomateEverything" ${localStorage.getItem(AUTO_KEY) === 'true' ? 'checked' : ''} />
      <span class="uw-checkmark" aria-hidden="true"></span>
      <span><strong>Automate everything <span class="uw-beta-pill">BETA</span></strong><span class="uw-option-copy">Skips both approval checks and publishes automatically. Beta automation cannot guarantee product placement, listing accuracy, or the final Spreadshirt result. Use only when you accept that risk.</span></span>`;
    newChat.parentElement.insertBefore(option, newChat);

    const checkbox = byId('ssAutomateEverything');
    checkbox?.addEventListener('change', () => {
      localStorage.setItem(AUTO_KEY, checkbox.checked ? 'true' : 'false');
      appendLog(checkbox.checked ? 'Automate everything BETA enabled.' : 'Automate everything disabled.', checkbox.checked ? 'warn' : '');
    });
    return true;
  }

  async function activeProject() {
    const projectId = localStorage.getItem(ACTIVE_KEY);
    if (!projectId) return null;
    try { return await window.zeroPOD?.projects?.get(projectId); }
    catch { return null; }
  }

  async function waitFor(predicate, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try { if (await predicate()) return true; } catch {}
      await sleep(450);
    }
    return false;
  }

  async function runAutoTick() {
    polishLabels();
    installAutomateEverythingControl();

    const checkbox = byId('ssAutomateEverything');
    if (!checkbox?.checked || autoAction) return;

    const project = await activeProject();
    if (!project || project.spreadshirt?.publishedAt) return;

    if (project.status === 'awaiting-review') {
      const pass = byId('ssPassImage');
      if (!pass || pass.disabled) return;
      autoAction = 'image-review';
      appendLog('AUTOMATE EVERYTHING beta enabled: skipping generated-image approval.', 'warn');
      pass.click();
      await waitFor(async () => {
        const next = await activeProject();
        return !next || next.status !== 'awaiting-review';
      }, 45000);
      autoAction = null;
      return;
    }

    if (project.spreadshirt?.preparedAt && !project.spreadshirt?.publishedAt) {
      const publish = byId('ssPublish');
      if (!publish || publish.disabled) return;
      autoAction = 'final-review';
      appendLog('AUTOMATE EVERYTHING beta enabled: skipping final review and publishing automatically.', 'warn');
      publish.click();
      await waitFor(async () => {
        const next = await activeProject();
        return !next || Boolean(next.spreadshirt?.publishedAt) || Boolean(next.spreadshirt?.lastError);
      }, 150000);
      autoAction = null;
    }
  }

  function install() {
    polishLabels();
    installAutomateEverythingControl();

    observer = new MutationObserver(() => {
      polishLabels();
      installAutomateEverythingControl();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    pollTimer = setInterval(() => runAutoTick().catch(() => { autoAction = null; }), 700);
  }

  install();
  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
    observer?.disconnect();
  });
})();