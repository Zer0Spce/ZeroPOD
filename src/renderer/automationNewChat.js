(() => {
  const STORAGE_KEY = 'zeropod.automation.newChat.v1';
  let interceptBusy = false;

  function log(message, kind = '') {
    if (typeof window.automationLog === 'function') {
      window.automationLog(message, kind);
      return;
    }
    console.log(`[ZeroPOD Automation] ${message}`);
  }

  function installStyles() {
    if (document.getElementById('automationNewChatStyles')) return;
    const style = document.createElement('style');
    style.id = 'automationNewChatStyles';
    style.textContent = `
      .az-new-chat-option{margin-top:14px;padding:12px 14px;border:1px solid var(--border,#394251);border-radius:11px;background:var(--surface-2,#141920)}
      .az-new-chat-option label{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;cursor:pointer;font-weight:600}
      .az-new-chat-option input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--accent,#6875ff)}
      .az-new-chat-option strong{display:block;font-size:13px;color:var(--text,#f5f7fa)}
      .az-new-chat-option span{display:block;margin-top:3px;font-size:11px;line-height:1.45;color:var(--muted,#98a3b2);font-weight:400}
    `;
    document.head.appendChild(style);
  }

  async function invokeNormalStart(button) {
    if (typeof window.startAutomationV2 === 'function') {
      return window.startAutomationV2();
    }

    const snapshot = await window.zeroPOD.automation.list();
    if (!snapshot.rows.length) {
      log('Add at least one job with the + button before starting.', 'warn');
      return;
    }
    const incomplete = snapshot.rows.findIndex((row) => !String(row.referenceImage || '').trim() || !String(row.amazonLink || '').trim());
    if (incomplete >= 0) {
      log(`Row ${incomplete + 1} needs both an image and source URL before starting.`, 'error');
      return;
    }
    log(`Starting full automation for ${snapshot.rows.length} job${snapshot.rows.length === 1 ? '' : 's'} · 1 → ${snapshot.rows.length}.`, 'warn');
    await window.zeroPOD.automation.start();
    if (typeof window.refreshAutomationListV2 === 'function') await window.refreshAutomationListV2();
    if (button) button.disabled = false;
  }

  async function startWithOptionalFreshChat(button, checkbox) {
    if (interceptBusy) return;
    interceptBusy = true;
    const originalDisabled = button.disabled;
    button.disabled = true;

    try {
      const snapshot = await window.zeroPOD.automation.list();

      if (!snapshot.rows.length) {
        await invokeNormalStart(button);
        return;
      }

      const incomplete = snapshot.rows.findIndex((row) => !String(row.referenceImage || '').trim() || !String(row.amazonLink || '').trim());
      if (incomplete >= 0) {
        await invokeNormalStart(button);
        return;
      }

      if (snapshot.state === 'running') {
        return;
      }

      // A paused queue is the same Automation run. Do not create another chat when
      // resuming it. A fresh chat is prepared only when starting from stopped.
      if (checkbox.checked && snapshot.state !== 'paused') {
        log('New Chat enabled · preparing one fresh ChatGPT conversation for this Automation run…', 'warn');
        await window.zeroPOD.generation.newChat();
        log('Fresh ChatGPT conversation ready. Every row in this run will reuse this same chat.', 'ok');
      }

      await invokeNormalStart(button);
    } catch (error) {
      log(`Could not start queue${checkbox.checked ? ' with New Chat' : ''}: ${error.message || error}`, 'error');
    } finally {
      interceptBusy = false;
      button.disabled = originalDisabled;
    }
  }

  function mount() {
    const controls = document.querySelector('#automation .az-controls');
    const startButton = document.getElementById('automationStartV2');
    if (!controls || !startButton || !window.zeroPOD?.automation || !window.zeroPOD?.generation?.newChat) return false;
    if (document.getElementById('automationNewChatOption')) return true;

    installStyles();

    const wrapper = document.createElement('div');
    wrapper.id = 'automationNewChatOption';
    wrapper.className = 'az-new-chat-option';
    const checked = localStorage.getItem(STORAGE_KEY) === 'true';
    wrapper.innerHTML = `
      <label>
        <input id="automationNewChatV2" type="checkbox" ${checked ? 'checked' : ''} />
        <span><strong>New Chat</strong><span>Start this Automation run in one fresh ChatGPT conversation. All rows reuse that same new chat; ZeroPOD does not create a new chat for every row.</span></span>
      </label>`;
    controls.insertAdjacentElement('beforebegin', wrapper);

    const checkbox = document.getElementById('automationNewChatV2');
    checkbox.addEventListener('change', () => localStorage.setItem(STORAGE_KEY, String(checkbox.checked)));

    startButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      startWithOptionalFreshChat(startButton, checkbox);
    }, true);

    return true;
  }

  function start() {
    if (mount()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (mount() || attempts >= 25) clearInterval(timer);
    }, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
