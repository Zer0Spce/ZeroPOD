const APPEARANCE_KEY = 'zeropod.appearance';
const media = window.matchMedia('(prefers-color-scheme: light)');

function getPreference() {
  return localStorage.getItem(APPEARANCE_KEY) || 'system';
}

function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return media.matches ? 'light' : 'dark';
}

function applyAppearance(preference = getPreference()) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.appearance = preference;
  document.querySelectorAll('[data-appearance-option]').forEach((button) => {
    button.classList.toggle('active-filter', button.dataset.appearanceOption === preference);
  });
  const label = document.getElementById('appearanceStatus');
  if (label) label.textContent = preference === 'system' ? `System · currently ${resolved}` : preference[0].toUpperCase() + preference.slice(1);
}

function setAppearance(preference) {
  if (!['system', 'light', 'dark'].includes(preference)) return;
  localStorage.setItem(APPEARANCE_KEY, preference);
  applyAppearance(preference);
}

function ensureAppearanceSettings() {
  const settings = document.getElementById('settings');
  if (!settings || document.getElementById('appearancePanel')) return;
  const panel = document.createElement('div');
  panel.id = 'appearancePanel';
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="heading-row"><div><h3>Appearance</h3><p class="muted">Choose how ZeroPOD looks. System follows your Windows light/dark preference automatically.</p></div><span id="appearanceStatus" class="stage-badge"></span></div>
    <div class="button-row appearance-options">
      <button data-appearance-option="system">System</button>
      <button data-appearance-option="dark">Dark</button>
      <button data-appearance-option="light">Light</button>
    </div>`;
  const anchor = settings.querySelector('.empty');
  if (anchor) settings.insertBefore(panel, anchor);
  else settings.appendChild(panel);
  panel.querySelectorAll('[data-appearance-option]').forEach((button) => button.addEventListener('click', () => setAppearance(button.dataset.appearanceOption)));
  applyAppearance();
}

media.addEventListener('change', () => { if (getPreference() === 'system') applyAppearance('system'); });
applyAppearance();
ensureAppearanceSettings();
