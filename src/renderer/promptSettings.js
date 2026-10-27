(() => {
  if (window.__zeroPODPromptSettingsInstalled) return;
  window.__zeroPODPromptSettingsInstalled = true;

  const api = window.zeroPOD?.promptSettings;
  const section = document.getElementById('settings');
  if (!api || !section) return;

  const style = document.createElement('style');
  style.id = 'promptSettingsStyles';
  style.textContent = `
    .prompt-settings-panel{margin-top:16px}
    .prompt-settings-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
    .prompt-mode-badge{padding:6px 9px;border-radius:999px;border:1px solid #3a4350;background:#151a20;color:#aeb8c7;font-size:11px;font-weight:800;letter-spacing:.03em;white-space:nowrap}
    .prompt-mode-badge.custom{border-color:#5e5429;background:#211d10;color:#ead57c}
    .prompt-settings-toggle{display:flex;gap:9px;align-items:center;margin:14px 0 10px;font-weight:700}
    .prompt-settings-toggle input{width:17px;height:17px;margin:0}
    .prompt-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}
    .prompt-settings-grid label{display:grid;gap:7px;font-size:12px;font-weight:800;color:#bec6d1}
    .prompt-settings-grid textarea{min-height:290px;resize:vertical;line-height:1.5;font-family:Consolas,monospace;font-size:12px}
    .prompt-settings-grid textarea[readonly]{opacity:.78}
    .prompt-settings-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
    .prompt-settings-meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:7px;font-size:11px;color:#7f8b9a}
    .prompt-settings-status{margin-top:12px;padding:9px 11px;border:1px solid #303844;border-radius:9px;background:#11161c;color:#9ba7b7;font-size:12px}
    .prompt-settings-status.ok{border-color:#315f48;background:#13231a;color:#91e2b5}
    .prompt-settings-status.error{border-color:#673740;background:#28151a;color:#ffabb4}
    @media(max-width:900px){.prompt-settings-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const oldEmpty = section.querySelector('.empty');
  if (oldEmpty) oldEmpty.remove();

  const panel = document.createElement('div');
  panel.id = 'promptSettingsPanel';
  panel.className = 'panel prompt-settings-panel';
  panel.innerHTML = `
    <div class="prompt-settings-head">
      <div>
        <h3>Generation Prompt</h3>
        <p class="muted">Controls the design-generation instructions sent to ChatGPT for both manual Workflow and Automation jobs.</p>
      </div>
      <span id="promptModeBadge" class="prompt-mode-badge">ZEROPOD DEFAULT</span>
    </div>

    <label class="prompt-settings-toggle"><input id="promptUseCustom" type="checkbox"> Use custom prompt instead of the ZeroPOD default</label>

    <div class="prompt-settings-grid">
      <label>ZeroPOD default prompt
        <textarea id="promptDefaultText" readonly spellcheck="false"></textarea>
        <span class="muted">Built into this ZeroPOD release. Resetting returns generation to this prompt.</span>
      </label>
      <label>Custom prompt
        <textarea id="promptCustomText" spellcheck="false" placeholder="Paste your own complete generation prompt here…"></textarea>
        <div class="prompt-settings-meta"><span>Saved locally on this PC.</span><span id="promptCharCount">0 characters</span></div>
      </label>
    </div>

    <div class="prompt-settings-actions">
      <button id="promptPasteCustom">Paste Custom Prompt</button>
      <button id="promptSave" class="primary">Save Prompt</button>
      <button id="promptReset" class="secondary">Reset to ZeroPOD Default</button>
    </div>
    <div id="promptSettingsStatus" class="prompt-settings-status">Loading prompt settings…</div>
  `;
  section.appendChild(panel);

  const byId = (id) => document.getElementById(id);
  const custom = byId('promptCustomText');
  const useCustom = byId('promptUseCustom');
  const defaultText = byId('promptDefaultText');
  const badge = byId('promptModeBadge');
  const status = byId('promptSettingsStatus');
  const charCount = byId('promptCharCount');

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.className = `prompt-settings-status${kind ? ` ${kind}` : ''}`;
  }

  function updateCharCount(max = 20000) {
    const length = custom.value.length;
    charCount.textContent = `${length.toLocaleString()} / ${Number(max || 20000).toLocaleString()} characters`;
  }

  function render(snapshot, message = '') {
    defaultText.value = snapshot.defaultPrompt || '';
    custom.value = snapshot.customPrompt || '';
    useCustom.checked = Boolean(snapshot.useCustomPrompt);
    custom.maxLength = Number(snapshot.maxCustomPromptLength) || 20000;
    badge.textContent = snapshot.activeMode === 'custom' ? 'CUSTOM PROMPT' : 'ZEROPOD DEFAULT';
    badge.classList.toggle('custom', snapshot.activeMode === 'custom');
    updateCharCount(snapshot.maxCustomPromptLength);
    if (message) setStatus(message, 'ok');
    else setStatus(snapshot.activeMode === 'custom'
      ? 'Custom prompt is active. New manual and Automation generations will use it.'
      : 'ZeroPOD default prompt is active. New manual and Automation generations will use the built-in POD rules.');
  }

  async function refresh() {
    try {
      render(await api.get());
    } catch (error) {
      setStatus(`Could not load prompt settings: ${error.message || error}`, 'error');
    }
  }

  custom.addEventListener('input', () => updateCharCount(custom.maxLength));

  byId('promptPasteCustom').addEventListener('click', async () => {
    try {
      const result = await api.pasteClipboard();
      const text = String(result?.text || '');
      if (!text.trim()) {
        setStatus('The Windows clipboard does not contain any text to paste.', 'error');
        return;
      }
      custom.value = text.slice(0, custom.maxLength || 20000);
      useCustom.checked = true;
      updateCharCount(custom.maxLength);
      setStatus('Custom prompt pasted from the Windows clipboard. Press Save Prompt to activate it.');
      custom.focus();
    } catch (error) {
      setStatus(`Could not paste the custom prompt: ${error.message || error}`, 'error');
    }
  });

  byId('promptSave').addEventListener('click', async () => {
    try {
      const snapshot = await api.save({
        useCustomPrompt: useCustom.checked,
        customPrompt: custom.value
      });
      render(snapshot, snapshot.activeMode === 'custom'
        ? 'Saved. Custom prompt is now active for future manual and Automation generations.'
        : 'Saved. ZeroPOD default prompt remains active.');
    } catch (error) {
      setStatus(`Could not save prompt settings: ${error.message || error}`, 'error');
    }
  });

  byId('promptReset').addEventListener('click', async () => {
    try {
      render(await api.reset(), 'Reset complete. ZeroPOD default prompt is active again.');
    } catch (error) {
      setStatus(`Could not reset the prompt: ${error.message || error}`, 'error');
    }
  });

  const settingsNav = document.querySelector('.nav[data-view="settings"]');
  settingsNav?.addEventListener('click', () => refresh());

  refresh();
})();
