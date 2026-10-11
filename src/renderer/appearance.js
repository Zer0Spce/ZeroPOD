const APPEARANCE_KEY = 'zeropod.appearance';
const COLOR_THEME_KEY = 'zeropod.colorTheme';
const media = window.matchMedia('(prefers-color-scheme: light)');

const COLOR_THEMES = [
  { id: 'orange', label: 'Orange' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'red', label: 'Red' },
  { id: 'purple', label: 'Purple' },
  { id: 'mono', label: 'White / Black' },
  { id: 'sunset', label: 'Sunset Orange' }
];

function getPreference() { return localStorage.getItem(APPEARANCE_KEY) || 'dark'; }
function getColorTheme() {
  const saved = localStorage.getItem(COLOR_THEME_KEY) || 'orange';
  return COLOR_THEMES.some((theme) => theme.id === saved) ? saved : 'orange';
}
function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return media.matches ? 'light' : 'dark';
}
function pretty(value) { return value ? value[0].toUpperCase() + value.slice(1) : ''; }

function decorateBrand() {
  const brand = document.querySelector('.brand');
  if (brand && !brand.querySelector('.brand-zero')) brand.innerHTML = '<span class="brand-zero">Zero</span><span class="brand-pod">POD</span>';
  const heading = document.querySelector('#dashboard h1');
  if (heading && !heading.querySelector('.brand-zero')) {
    heading.classList.add('brand-heading');
    heading.innerHTML = '<span class="brand-zero">Zero</span><span class="brand-pod">POD</span>';
  }
}

function updateDashboardControls() {
  const toggle = document.getElementById('dashboardModeToggle');
  if (toggle) {
    const resolved = resolveTheme(getPreference());
    toggle.innerHTML = resolved === 'dark' ? '<span>☀</span> Light' : '<span>☾</span> Dark';
    toggle.title = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
  const select = document.getElementById('dashboardThemeSelect');
  if (select) select.value = getColorTheme();
}

function applyAppearance(preference = getPreference(), colorTheme = getColorTheme()) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.appearance = preference;
  document.documentElement.dataset.accent = colorTheme;
  document.querySelectorAll('[data-appearance-option]').forEach((button) => button.classList.toggle('active-filter', button.dataset.appearanceOption === preference));
  document.querySelectorAll('[data-color-theme]').forEach((button) => button.classList.toggle('active-theme', button.dataset.colorTheme === colorTheme));
  const appearanceLabel = document.getElementById('appearanceStatus');
  if (appearanceLabel) appearanceLabel.textContent = preference === 'system' ? `System · ${resolved}` : pretty(preference);
  const themeLabel = document.getElementById('themeStatus');
  if (themeLabel) themeLabel.textContent = COLOR_THEMES.find((theme) => theme.id === colorTheme)?.label || 'Orange';
  decorateBrand();
  updateDashboardControls();
}

function setAppearance(preference) {
  if (!['system', 'light', 'dark'].includes(preference)) return;
  localStorage.setItem(APPEARANCE_KEY, preference);
  applyAppearance(preference, getColorTheme());
}
function setColorTheme(themeId) {
  if (!COLOR_THEMES.some((theme) => theme.id === themeId)) return;
  localStorage.setItem(COLOR_THEME_KEY, themeId);
  applyAppearance(getPreference(), themeId);
}
function toggleAppearance() { setAppearance(resolveTheme(getPreference()) === 'dark' ? 'light' : 'dark'); }

function ensureDashboardAppearanceControls() {
  const button = document.getElementById('dashboardNewDesign');
  if (!button || document.getElementById('dashboardAppearanceControls')) return;
  const row = button.parentElement;
  if (!row) return;
  const actions = document.createElement('div');
  actions.id = 'dashboardAppearanceControls';
  actions.className = 'dashboard-actions';
  actions.innerHTML = `
    <label class="theme-select-wrap" title="Color theme">
      <span class="theme-dot" aria-hidden="true"></span>
      <select id="dashboardThemeSelect" aria-label="ZeroPOD color theme">
        ${COLOR_THEMES.map((theme) => `<option value="${theme.id}">${theme.label}</option>`).join('')}
      </select>
    </label>
    <button id="dashboardModeToggle" class="mode-toggle secondary" type="button"></button>`;
  row.replaceChild(actions, button);
  actions.appendChild(button);
  document.getElementById('dashboardModeToggle').addEventListener('click', toggleAppearance);
  document.getElementById('dashboardThemeSelect').addEventListener('change', (event) => setColorTheme(event.target.value));
  updateDashboardControls();
}

function ensureAppearanceSettings() {
  const settings = document.getElementById('settings');
  if (!settings || document.getElementById('appearancePanel')) return;
  const panel = document.createElement('div');
  panel.id = 'appearancePanel';
  panel.className = 'panel appearance-panel';
  panel.innerHTML = `
    <div class="heading-row">
      <div><h3>Appearance</h3><p class="muted">Choose the accent family and light/dark mode. Orange is the default ZeroPOD theme.</p></div>
      <div class="appearance-status-stack"><span id="themeStatus" class="stage-badge"></span><span id="appearanceStatus" class="stage-badge"></span></div>
    </div>
    <div class="appearance-section-label">Color theme</div>
    <div class="theme-grid">${COLOR_THEMES.map((theme) => `<button class="theme-choice theme-${theme.id}" data-color-theme="${theme.id}" type="button"><span class="theme-choice-swatch"></span><span>${theme.label}</span></button>`).join('')}</div>
    <div class="appearance-section-label">Mode</div>
    <div class="button-row appearance-options"><button data-appearance-option="dark" type="button">Dark</button><button data-appearance-option="light" type="button">Light</button><button data-appearance-option="system" type="button">System</button></div>`;
  const anchor = settings.querySelector('.empty');
  if (anchor) settings.insertBefore(panel, anchor); else settings.appendChild(panel);
  panel.querySelectorAll('[data-appearance-option]').forEach((button) => button.addEventListener('click', () => setAppearance(button.dataset.appearanceOption)));
  panel.querySelectorAll('[data-color-theme]').forEach((button) => button.addEventListener('click', () => setColorTheme(button.dataset.colorTheme)));
  applyAppearance();
}

function installLateThemeOverrides() {
  if (document.getElementById('zeroPodLateThemeOverrides')) return;
  const style = document.createElement('style');
  style.id = 'zeroPodLateThemeOverrides';
  style.textContent = `
    .az-panel,.uw-panel,.sc-card,.sc-dialog,.sc-result,#flyingResearch .fr-card,#flyingResearch .fr-selection,#flyingResearch .fr-detail,#flyingResearch .fr-notice{background:var(--surface)!important;border-color:var(--border)!important;color:var(--text)}
    .az-row,.az-summary span,.az-result,.uw-meta-row,.uw-status,.uw-log,.az-log{background:var(--bg-elevated)!important;border-color:var(--border)!important;color:var(--text)}
    .az-index,.az-state,.uw-timer{background:var(--surface-2)!important;border-color:var(--border)!important;color:var(--muted)}
    .az-row input,.az-url,#flyingResearch input,#flyingResearch select{background:var(--bg-elevated)!important;border-color:var(--border)!important;color:var(--text)!important}
    #flyingResearch .fr-tools .active{background:linear-gradient(135deg,var(--accent),var(--accent-2))!important;color:var(--accent-ink)!important}
    #flyingResearch input[type=checkbox]{accent-color:var(--accent)!important}
    #flyingResearch .fr-card.selected,#flyingResearch .fr-selection{border-color:var(--accent)!important;box-shadow:0 0 0 2px var(--accent-soft)}
  `;
  document.head.appendChild(style);
}

function loadZeroPODFeatureScript(src, id) {
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.src = src;
  script.defer = true;
  document.body.appendChild(script);
}

function hideResearchBeta() {
  document.querySelectorAll('.nav[data-view="research"]').forEach((node) => node.remove());
  document.querySelectorAll('#research').forEach((node) => node.remove());
}

function loadResearchFeatures() {
  // Research / Research BETA is intentionally hidden for now. Keep its files in
  // the codebase so we can fix and re-enable it later without affecting Flying Research BETA.
  hideResearchBeta();

  // Automate List uses the existing Amazon Research browser profile to retrieve
  // the product image from each Amazon link. Keep this connection visible even
  // while the separate Research BETA tab remains hidden.
  try {
    if (typeof serviceOrder !== 'undefined' && Array.isArray(serviceOrder) && !serviceOrder.includes('amazonResearch')) {
      serviceOrder.push('amazonResearch');
      if (typeof renderConnections === 'function') Promise.resolve(renderConnections()).catch(() => {});
    }
  } catch {}

  loadZeroPODFeatureScript('automateList.js', 'automateListFeatureScript');
  loadZeroPODFeatureScript('storageSettings.js', 'storageSettingsFeatureScript');
  loadZeroPODFeatureScript('redbubbleLimit.js', 'redbubbleLimitFeatureScript');
  setTimeout(() => {
    hideResearchBeta();
    installLateThemeOverrides();
  }, 0);
}

media.addEventListener('change', () => { if (getPreference() === 'system') applyAppearance('system', getColorTheme()); });
applyAppearance();
ensureDashboardAppearanceControls();
ensureAppearanceSettings();
if (document.readyState === 'complete') loadResearchFeatures();
else window.addEventListener('load', loadResearchFeatures, { once: true });
