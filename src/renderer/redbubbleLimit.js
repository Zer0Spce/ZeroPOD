(() => {
  const REFERENCE_LIMIT = 30;
  const CHECK_INTERVAL_OPTIONS = [1, 2, 4, 8, 12, 24];
  let usage = { count: 0, blocked: false, detectedAt: null, clearedAt: null, message: null };
  let checkSettings = { intervalHours: 1, lastCheckedAt: null, lastCheckResult: null, lastCheckMessage: null, lastCheckSource: null, nextCheckAt: null };
  let refreshTimer = null;
  let automationTimer = null;
  let checkBusy = false;

  function formatDate(value) {
    if (!value) return 'Never';
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
  }

  function resultLabel(value) {
    if (value === 'available') return 'UPLOAD AVAILABLE';
    if (value === 'limited') return 'LIMIT REACHED';
    if (value === 'error') return 'CHECK ERROR';
    return 'NOT CHECKED';
  }

  function sourceLabel(value) {
    if (value === 'automatic') return 'Automatic';
    if (value === 'manual') return 'Manual';
    return '—';
  }

  function ensureStyles() {
    if (document.getElementById('redbubbleLimitPauseStyles')) return;
    const style = document.createElement('style');
    style.id = 'redbubbleLimitPauseStyles';
    style.textContent = `
      .rb-limit-automation-notice{display:none;margin:12px 0 0;padding:13px 15px;border-radius:11px;border:1px solid rgba(239,68,68,.45);background:rgba(239,68,68,.09);color:var(--text);line-height:1.45}.rb-limit-automation-notice.visible{display:block}.rb-limit-automation-notice strong{display:block;color:#ff9898;margin-bottom:4px}.rb-limit-automation-notice span{color:var(--muted);font-size:12px}
      .rb-check-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}.rb-check-row button{min-width:150px}.rb-check-meta{display:grid;gap:3px;color:var(--muted);font-size:12px}.rb-check-meta strong{color:var(--text);font-weight:700}.rb-last-checked{font-variant-numeric:tabular-nums}
      .rb-limit-settings{margin-top:16px}.rb-limit-settings-grid{display:grid;grid-template-columns:minmax(220px,.55fr) minmax(0,1fr);gap:16px;align-items:end}.rb-limit-settings select{width:100%;background:var(--bg-elevated);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:10px 11px}.rb-limit-settings select option{background:var(--surface);color:var(--text)}.rb-limit-status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.rb-limit-status-box{background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:11px}.rb-limit-status-box span{display:block;color:var(--muted);font-size:11px;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}.rb-limit-status-box strong{font-size:13px}.rb-limit-settings-note{margin-top:10px;color:var(--muted);font-size:12px;line-height:1.45}@media(max-width:900px){.rb-limit-settings-grid,.rb-limit-status-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureCard() {
    const stats = document.getElementById('dashboardStats');
    if (!stats) return null;
    let card = document.getElementById('redbubbleDailyLimit');
    if (card) return card;

    card = document.createElement('section');
    card.id = 'redbubbleDailyLimit';
    card.className = 'redbubble-limit-card';
    card.innerHTML = `
      <div class="redbubble-limit-copy">
        <div class="eyebrow">REDBUBBLE · LIVE LIMIT DETECTION</div>
        <div class="redbubble-limit-title-row"><h3>Upload limit status</h3><span id="redbubbleLimitBadge" class="redbubble-limit-badge">CHECKING</span></div>
        <p id="redbubbleLimitSummary" class="muted">Checking Redbubble limit status…</p>
        <div class="redbubble-limit-meta">
          <span><strong id="redbubbleTrackedCount">0</strong> successful ZeroPOD publishes in the last 24h</span>
          <span id="redbubbleDetectionLabel">No Redbubble limit page detected</span>
        </div>
        <div class="rb-check-row">
          <button id="redbubbleCheckNow" class="secondary" type="button">Check Upload Limit</button>
          <div class="rb-check-meta">
            <span>Last checked: <strong id="redbubbleLastChecked" class="rb-last-checked">Never</strong></span>
            <span id="redbubbleLastCheckDetail">Automatic checks every 1 hour</span>
          </div>
        </div>
        <p class="redbubble-limit-note">The local publish count is informational only. ZeroPOD does <strong>not</strong> stop publishing when this count reaches ${REFERENCE_LIMIT}. The upload limit is considered reached only when Redbubble itself shows its “exceeded your upload limit” page/message. Manual and automatic checks safely test Copy Settings without replacing artwork or saving a new work.</p>
      </div>
      <div class="redbubble-limit-clock"><span>REDBUBBLE</span><strong id="redbubbleLimitState">READY</strong><small>page-based detection</small></div>`;
    stats.insertAdjacentElement('afterend', card);
    document.getElementById('redbubbleCheckNow')?.addEventListener('click', runManualCheck);
    return card;
  }

  function ensureSettingsPanel() {
    ensureStyles();
    const settings = document.getElementById('settings');
    if (!settings || document.getElementById('redbubbleLimitSettingsPanel')) return;
    settings.querySelector('.empty')?.remove();
    const panel = document.createElement('div');
    panel.id = 'redbubbleLimitSettingsPanel';
    panel.className = 'panel rb-limit-settings';
    panel.innerHTML = `
      <div class="heading-row"><div><div class="eyebrow">REDBUBBLE</div><h3>Upload Limit Checker</h3><p class="muted">ZeroPOD safely tests Redbubble by opening the first work's Copy Settings flow. Nothing is uploaded, replaced, or saved during the check.</p></div><span id="rbLimitSettingsBadge" class="stage-badge">AUTO · 1H</span></div>
      <div class="rb-limit-settings-grid">
        <label>Automatic check interval<select id="rbLimitCheckInterval">${CHECK_INTERVAL_OPTIONS.map((hours) => `<option value="${hours}">Every ${hours} hour${hours === 1 ? '' : 's'}</option>`).join('')}</select></label>
        <div class="button-row"><button id="rbLimitSaveInterval" class="primary" type="button">Save Check Interval</button><button id="rbLimitCheckFromSettings" type="button">Check Now</button></div>
      </div>
      <div class="rb-limit-status-grid">
        <div class="rb-limit-status-box"><span>Last checked</span><strong id="rbSettingsLastChecked">Never</strong></div>
        <div class="rb-limit-status-box"><span>Last result</span><strong id="rbSettingsLastResult">Not checked</strong></div>
        <div class="rb-limit-status-box"><span>Next automatic check</span><strong id="rbSettingsNextCheck">Not scheduled</strong></div>
      </div>
      <div id="rbLimitSettingsMessage" class="rb-limit-settings-note">Default: every 1 hour. If Automation is actively running when a check becomes due, ZeroPOD waits and checks as soon as Automation is no longer running.</div>`;
    settings.appendChild(panel);
    document.getElementById('rbLimitSaveInterval')?.addEventListener('click', saveInterval);
    document.getElementById('rbLimitCheckFromSettings')?.addEventListener('click', runManualCheck);
  }

  function ensureAutomationNotice() {
    ensureStyles();
    const section = document.getElementById('automation');
    if (!section) return null;
    let notice = document.getElementById('redbubbleAutomationLimitNotice');
    if (notice) return notice;
    const warning = section.querySelector('.az-warning');
    if (!warning) return null;
    notice = document.createElement('div');
    notice.id = 'redbubbleAutomationLimitNotice';
    notice.className = 'rb-limit-automation-notice';
    warning.insertAdjacentElement('afterend', notice);
    return notice;
  }

  function render() {
    const card = ensureCard();
    ensureSettingsPanel();
    if (!card) return;

    const count = Number(usage.localCount ?? usage.count ?? 0);
    const blocked = Boolean(usage.blocked);
    const badge = document.getElementById('redbubbleLimitBadge');
    const summary = document.getElementById('redbubbleLimitSummary');
    const state = document.getElementById('redbubbleLimitState');
    const detectionLabel = document.getElementById('redbubbleDetectionLabel');

    document.getElementById('redbubbleTrackedCount').textContent = String(count);
    document.getElementById('redbubbleLastChecked').textContent = formatDate(checkSettings.lastCheckedAt);
    document.getElementById('redbubbleLastCheckDetail').textContent = `${resultLabel(checkSettings.lastCheckResult)} · ${sourceLabel(checkSettings.lastCheckSource)} · Auto every ${checkSettings.intervalHours || 1}h`;
    card.classList.toggle('limit-reached', blocked);
    badge.classList.toggle('limit-reached', blocked);

    if (blocked) {
      badge.textContent = 'LIMIT DETECTED';
      state.textContent = 'BLOCKED';
      summary.textContent = usage.message || 'Redbubble itself reported that the upload limit has been reached.';
      detectionLabel.textContent = `Detected from Redbubble: ${formatDate(usage.detectedAt)}`;
    } else {
      badge.textContent = 'READY';
      state.textContent = 'READY';
      summary.textContent = 'No Redbubble upload-limit warning is currently active. ZeroPOD will keep attempting normal publishes regardless of the local count.';
      detectionLabel.textContent = usage.clearedAt
        ? `Last confirmed available: ${formatDate(usage.clearedAt)}`
        : 'No Redbubble limit page detected';
    }

    const interval = document.getElementById('rbLimitCheckInterval');
    if (interval) interval.value = String(checkSettings.intervalHours || 1);
    const settingsBadge = document.getElementById('rbLimitSettingsBadge');
    if (settingsBadge) settingsBadge.textContent = `AUTO · ${checkSettings.intervalHours || 1}H`;
    const lastChecked = document.getElementById('rbSettingsLastChecked');
    if (lastChecked) lastChecked.textContent = formatDate(checkSettings.lastCheckedAt);
    const lastResult = document.getElementById('rbSettingsLastResult');
    if (lastResult) lastResult.textContent = resultLabel(checkSettings.lastCheckResult);
    const nextCheck = document.getElementById('rbSettingsNextCheck');
    if (nextCheck) nextCheck.textContent = checkSettings.deferredBecauseAutomation ? 'Due · waiting for Automation' : formatDate(checkSettings.nextCheckAt);
  }

  async function runManualCheck() {
    if (checkBusy || !window.zeroPOD?.redbubble?.checkUploadLimit) return;
    checkBusy = true;
    const buttons = [document.getElementById('redbubbleCheckNow'), document.getElementById('rbLimitCheckFromSettings')].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; button.dataset.oldText = button.textContent; button.textContent = 'Checking…'; });
    const message = document.getElementById('rbLimitSettingsMessage');
    if (message) message.textContent = 'Opening Redbubble Manage Works and testing Copy Settings…';
    try {
      const result = await window.zeroPOD.redbubble.checkUploadLimit();
      if (result?.settings) checkSettings = result.settings;
      if (message) message.textContent = result?.message || 'Redbubble upload-limit check finished.';
      await refresh();
    } catch (error) {
      if (message) message.textContent = `Check failed: ${error.message || error}`;
    } finally {
      checkBusy = false;
      buttons.forEach((button) => { button.disabled = false; button.textContent = button.dataset.oldText || 'Check Upload Limit'; });
    }
  }

  async function saveInterval() {
    const select = document.getElementById('rbLimitCheckInterval');
    const message = document.getElementById('rbLimitSettingsMessage');
    if (!select || !window.zeroPOD?.redbubble?.updateLimitCheckSettings) return;
    try {
      checkSettings = await window.zeroPOD.redbubble.updateLimitCheckSettings({ intervalHours: Number(select.value) });
      if (message) message.textContent = `Automatic Redbubble upload-limit checks set to every ${checkSettings.intervalHours} hour${checkSettings.intervalHours === 1 ? '' : 's'}.`;
      render();
    } catch (error) {
      if (message) message.textContent = `Could not save interval: ${error.message || error}`;
    }
  }

  async function refreshAutomationNotice() {
    const notice = ensureAutomationNotice();
    if (!notice || !window.zeroPOD?.automation?.list) return;
    try {
      const snapshot = await window.zeroPOD.automation.list();
      const recovery = snapshot.recovery || {};
      const active = snapshot.state === 'paused' && recovery.type === 'redbubble-upload-limit';
      notice.classList.toggle('visible', active);
      if (!active) { notice.innerHTML = ''; return; }
      const recovered = Number(recovery.recoveredRows || 0);
      notice.innerHTML = `<strong>⏸ Automation paused — Redbubble upload limit reached</strong><span>${recovery.message || 'Redbubble reported that uploads are currently blocked.'} All unfinished jobs were preserved at their current stage.${recovered ? ` ${recovered} earlier Redbubble failure${recovered === 1 ? '' : 's'} were returned to the queue because they occurred while this limit page was active.` : ''} Use Check Upload Limit on the Dashboard whenever you want to test Redbubble again.</span>`;
    } catch {}
  }

  async function refresh() {
    try {
      if (!window.zeroPOD?.redbubble) return;
      const [nextUsage, nextSettings] = await Promise.all([
        window.zeroPOD.redbubble.dailyUsage?.(),
        window.zeroPOD.redbubble.limitCheckSettings?.()
      ]);
      if (nextUsage) usage = nextUsage;
      if (nextSettings) checkSettings = nextSettings;
      render();
    } catch (error) {
      ensureCard();
      ensureSettingsPanel();
      const summary = document.getElementById('redbubbleLimitSummary');
      if (summary) summary.textContent = `Redbubble limit status unavailable: ${error.message || error}`;
    }
    await refreshAutomationNotice();
  }

  window.refreshRedbubbleUsage = refresh;
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  ensureStyles();
  ensureCard();
  ensureSettingsPanel();
  refresh();
  if (!refreshTimer) refreshTimer = setInterval(refresh, 30000);
  if (!automationTimer) automationTimer = setInterval(refreshAutomationNotice, 1500);
})();
