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

function getPreference() {
  return localStorage.getItem(APPEARANCE_KEY) || 'dark';
}

function getColorTheme() {
  const saved = localStorage.getItem(COLOR_THEME_KEY) || 'orange';
  return COLOR_THEMES.some((theme) => theme.id === saved) ? saved : 'orange';
}

function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return media.matches ? 'light' : 'dark';
}

function prettyMode(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}

function decorateBrand() {
  const brand = document.querySelector('.brand');
  if (brand && !brand.querySelector('.brand-zero')) {
    brand.innerHTML = '<span class="brand-zero">Zero</span><span class="brand-pod">POD</span>';
  }
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

  document.querySelectorAll('[data-appearance-option]').forEach((button) => {
    button.classList.toggle('active-filter', button.dataset.appearanceOption === preference);
  });
  document.querySelectorAll('[data-color-theme]').forEach((button) => {
    button.classList.toggle('active-theme', button.dataset.colorTheme === colorTheme);
  });

  const appearanceLabel = document.getElementById('appearanceStatus');
  if (appearanceLabel) appearanceLabel.textContent = preference === 'system' ? `System · ${resolved}` : prettyMode(preference);
  const themeLabel = document.getElementById('themeStatus');
  if (themeLabel) themeLabel.textContent = COLOR_THEMES.find((theme) => theme.id === colorTheme)?.label || 'Orange';

  updateDashboardControls();
  decorateBrand();
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

function toggleAppearance() {
  const current = resolveTheme(getPreference());
  setAppearance(current === 'dark' ? 'light' : 'dark');
}

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
    <div class="theme-grid">
      ${COLOR_THEMES.map((theme) => `<button class="theme-choice theme-${theme.id}" data-color-theme="${theme.id}" type="button"><span class="theme-choice-swatch"></span><span>${theme.label}</span></button>`).join('')}
    </div>
    <div class="appearance-section-label">Mode</div>
    <div class="button-row appearance-options">
      <button data-appearance-option="dark" type="button">Dark</button>
      <button data-appearance-option="light" type="button">Light</button>
      <button data-appearance-option="system" type="button">System</button>
    </div>`;

  const anchor = settings.querySelector('.empty');
  if (anchor) settings.insertBefore(panel, anchor);
  else settings.appendChild(panel);

  panel.querySelectorAll('[data-appearance-option]').forEach((button) => button.addEventListener('click', () => setAppearance(button.dataset.appearanceOption)));
  panel.querySelectorAll('[data-color-theme]').forEach((button) => button.addEventListener('click', () => setColorTheme(button.dataset.colorTheme)));
  applyAppearance();
}

function ensureCacheSettings() {
  const settings = document.getElementById('settings');
  if (!settings || document.getElementById('cachePanel')) return;
  const panel = document.createElement('div');
  panel.id = 'cachePanel';
  panel.className = 'panel cache-panel';
  panel.innerHTML = `
    <div class="heading-row">
      <div><h3>Cache</h3><p class="muted">Clear temporary Chromium/browser cache without removing ZeroPOD projects, workflow data, theme settings, cookies, or saved logins.</p></div>
      <button id="clearCacheButton" class="secondary" type="button">Clear Cache</button>
    </div>
    <div id="clearCacheStatus" class="last-seen">Nothing cleared yet.</div>`;

  const anchor = settings.querySelector('.empty');
  if (anchor) settings.insertBefore(panel, anchor);
  else settings.appendChild(panel);

  document.getElementById('clearCacheButton').addEventListener('click', async () => {
    const button = document.getElementById('clearCacheButton');
    const status = document.getElementById('clearCacheStatus');
    button.disabled = true;
    button.textContent = 'Clearing…';
    status.textContent = 'Clearing temporary cache. Saved sessions and project data will be preserved.';
    try {
      const result = await window.zeroPOD.app.clearCache();
      status.textContent = `${result.message}${Number.isFinite(result.deletedCount) ? ` Removed ${result.deletedCount} cache folder${result.deletedCount === 1 ? '' : 's'}.` : ''}`;
      button.textContent = 'Cleared ✓';
      setTimeout(() => { button.textContent = 'Clear Cache'; }, 1800);
    } catch (error) {
      status.textContent = `Cache could not be fully cleared: ${error.message || error}`;
      button.textContent = 'Clear Cache';
    } finally {
      button.disabled = false;
    }
  });
}

media.addEventListener('change', () => {
  if (getPreference() === 'system') applyAppearance('system', getColorTheme());
});

applyAppearance();
ensureDashboardAppearanceControls();
ensureAppearanceSettings();
ensureCacheSettings();
