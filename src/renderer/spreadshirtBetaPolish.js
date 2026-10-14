(() => {
  if (window.__zeroPODSpreadshirtBetaPolishInstalled) return;
  window.__zeroPODSpreadshirtBetaPolishInstalled = true;

  const AUTO_KEY = 'zeropod.spreadshirt.automateEverything.v1';
  const ACTIVE_KEY = 'zeropod.spreadshirt.alpha.activeProject';
  const NEW_CHAT_KEY = 'zeropod.spreadshirt.alpha.newChat';
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

  function installFallbackStyles() {
    if (byId('spreadshirtPolishStyles')) return;
    const style = document.createElement('style');
    style.id = 'spreadshirtPolishStyles';
    style.textContent = `
      #spreadshirtAlpha .uw-option{position:relative;display:grid;grid-template-columns:28px 1fr;gap:12px;align-items:start;padding:14px 16px;border:1px solid #394251;background:#141920;border-radius:12px;cursor:pointer;margin-top:10px}
      #spreadshirtAlpha .uw-option-beta{border-color:#62522b;background:#241f12}
      #spreadshirtAlpha .uw-option input{position:absolute;opacity:0;pointer-events:none}
      #spreadshirtAlpha .uw-checkmark{width:22px;height:22px;border:2px solid #657083;border-radius:6px;background:#0f1318;display:grid;place-items:center;margin-top:1px}
      #spreadshirtAlpha .uw-option input:checked + .uw-checkmark{background:#6875ff;border-color:#7f89ff;box-shadow:0 0 0 3px rgba(104,117,255,.14)}
      #spreadshirtAlpha .uw-option input:checked + .uw-checkmark::after{content:'✓';color:white;font-weight:900;font-size:14px;line-height:1}
      #spreadshirtAlpha .uw-option strong{display:block;font-size:14px}
      #spreadshirtAlpha .uw-option-copy{display:block;font-size:12px;color:#98a3b2;line-height:1.45;margin-top:4px}
      #spreadshirtAlpha .uw-beta-pill{display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;background:#4a3d16;color:#f1d462;font-size:9px;font-weight:800;letter-spacing:.05em;margin-left:4px}
    `;
    document.head.appendChild(style);
  }

  function polishLabels() {
    const redbubbleNav = document.querySelector('.nav[data-view="create"]');
    if (redbubbleNav && redbubbleNav.textContent.trim() !== 'Redbubble') redbubbleNav.textContent = 'Redbubble';

    const redbubbleHeading = document.querySelector('#create h2');
    if (redbubbleHeading && /^Workflow$/i.test(redbubbleHeading.textContent.trim())) redbubbleHeading.textContent = 'Redbubble';

    const spreadshirtNav = document.querySelector('.nav[data-view="spreadshirtAlpha"]');
    if (spreadshirtNav && spreadshirtNav.textContent.trim() !== 'Spreadshirt') spreadshirtNav.textContent = 'Spreadshirt';

    const spreadshirtHeading = document.querySelector('#spreadshirtAlpha h2');
    if (spreadshirtHeading && spreadshirtHeading.textContent.trim() !== 'Spreadshirt') spreadshirtHeading.textContent = 'Spreadshirt';

    document.querySelectorAll('#spreadshirtAlpha .ss-alpha-mark').forEach((node) => node.remove());
    document.querySelectorAll('#spreadshirtAlpha .ss-badge').forEach((node) => {
      if (/^alpha$/i.test(node.textContent.trim())) node.remove();
    });
  }

  function fixNewChatControl() {
    const input = byId('ssNewChat');
    const label = input?.closest('label');
    if (!input || !label) return false;

    installFallbackStyles();
    label.classList.remove('ss-option');
    label.classList.add('uw-option', 'ss-new-chat-polished');

    if (!label.querySelector('.uw-checkmark')) {
      const mark = document.createElement('span');
      mark.className = 'uw-checkmark';
      mark.setAttribute('aria-hidden', 'true');
      input.insertAdjacentElement('afterend', mark);
    }

    const copy = label.querySelector(':scope > span:not(.uw-checkmark)');
    if (copy) {
      copy.querySelector('.ss-small')?.classList.add('uw-option-copy');
    }

    if (input.dataset.zeroPodNewChatFixed !== '1') {
      input.dataset.zeroPodNewChatFixed = '1';
      // Keep compatibility with the original Spreadshirt workflow, which stores
      // this setting as 1/0 and reads the live checkbox when generation starts.
      const saved = localStorage.getItem(NEW_CHAT_KEY);
      if (saved === '1' || saved === '0') input.checked = saved === '1';
      input.addEventListener('change', () => {
        localStorage.setItem(NEW_CHAT_KEY, input.checked ? '1' : '0');
        appendLog(input.checked ? 'New Chat enabled for the next Spreadshirt design.' : 'New Chat disabled; the last working ChatGPT thread will be reused.', '');
      });
    }
    return true;
  }

  function installAutomateEverythingControl() {
    if (byId('ssAutomateEverything')) return true;
    const newChat = byId('ssNewChat')?.closest('label');
    if (!newChat?.parentElement) return false;

    installFallbackStyles();
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
    fixNewChatControl();
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
    fixNewChatControl();
    installAutomateEverythingControl();

    observer = new MutationObserver(() => {
      polishLabels();
      fixNewChatControl();
      installAutomateEverythingControl();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    pollTimer = setInterval(() => runAutoTick().catch(() => { autoAction = null; }), 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
    observer?.disconnect();
  });
})();
