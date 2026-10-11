const REDBUBBLE_LIMIT = 30;
const REDBUBBLE_WINDOW_MS = 24 * 60 * 60 * 1000;
let redbubbleUsage = { count: 0, remaining: REDBUBBLE_LIMIT, blocked: false, nextSlotAt: null };
let redbubbleRefreshTimer = null;
let redbubbleClockTimer = null;

function formatCountdown(target) {
  if (!target) return 'No reset timer yet';
  const remaining = Math.max(0, target - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ensureLimitCard() {
  const dashboard = document.getElementById('dashboard');
  const stats = document.getElementById('dashboardStats');
  if (!dashboard || !stats) return null;
  let card = document.getElementById('redbubbleDailyLimit');
  if (card) return card;

  card = document.createElement('section');
  card.id = 'redbubbleDailyLimit';
  card.className = 'redbubble-limit-card';
  card.innerHTML = `
    <div class="redbubble-limit-copy">
      <div class="eyebrow">REDBUBBLE DAILY CAP</div>
      <div class="redbubble-limit-title-row">
        <h3>Upload tracker</h3>
        <span id="redbubbleLimitBadge" class="redbubble-limit-badge">0 / ${REDBUBBLE_LIMIT}</span>
      </div>
      <p id="redbubbleLimitSummary" class="muted">Checking successful ZeroPOD publishes from the last 24 hours…</p>
      <div class="redbubble-limit-progress"><div id="redbubbleLimitProgressBar"></div></div>
      <div class="redbubble-limit-meta">
        <span><strong id="redbubbleRemaining">${REDBUBBLE_LIMIT}</strong> slots available</span>
        <span id="redbubbleResetLabel">Rolling 24-hour window</span>
      </div>
      <p class="redbubble-limit-note">ZeroPOD estimates this from successful publishes it knows about. Manual uploads outside ZeroPOD are not counted. If Redbubble shows its upload-limit warning, treat Redbubble as the source of truth and resume only after that warning disappears.</p>
    </div>
    <div class="redbubble-limit-clock">
      <span>${REDBUBBLE_LIMIT} max</span>
      <strong id="redbubbleResetCountdown">--:--:--</strong>
      <small id="redbubbleResetCaption">next tracked slot</small>
    </div>`;
  stats.insertAdjacentElement('afterend', card);
  return card;
}

async function readRedbubbleUsage() {
  const projects = await window.zeroPOD.projects.list();
  const now = Date.now();
  const cutoff = now - REDBUBBLE_WINDOW_MS;
  const timestamps = projects
    .map((project) => Date.parse(project.redbubble?.publishedAt || ''))
    .filter((value) => Number.isFinite(value) && value > cutoff && value <= now)
    .sort((a, b) => a - b);

  redbubbleUsage = {
    count: timestamps.length,
    remaining: Math.max(0, REDBUBBLE_LIMIT - timestamps.length),
    blocked: timestamps.length >= REDBUBBLE_LIMIT,
    nextSlotAt: timestamps.length ? timestamps[0] + REDBUBBLE_WINDOW_MS : null
  };
  return redbubbleUsage;
}

function renderRedbubbleUsage() {
  const card = ensureLimitCard();
  if (!card) return;
  const { count, remaining, blocked, nextSlotAt } = redbubbleUsage;
  const percent = Math.min(100, (count / REDBUBBLE_LIMIT) * 100);
  const badge = document.getElementById('redbubbleLimitBadge');
  const summary = document.getElementById('redbubbleLimitSummary');
  const progress = document.getElementById('redbubbleLimitProgressBar');
  const remainingNode = document.getElementById('redbubbleRemaining');
  const resetLabel = document.getElementById('redbubbleResetLabel');
  const countdown = document.getElementById('redbubbleResetCountdown');
  const caption = document.getElementById('redbubbleResetCaption');

  badge.textContent = `${count} / ${REDBUBBLE_LIMIT}`;
  badge.classList.toggle('limit-reached', blocked);
  progress.style.width = `${percent}%`;
  remainingNode.textContent = String(remaining);
  card.classList.toggle('limit-reached', blocked);

  if (!count) {
    summary.textContent = 'All 30 locally tracked upload slots are available.';
    resetLabel.textContent = 'Rolling 24-hour window';
    countdown.textContent = 'READY';
    caption.textContent = 'all slots available';
  } else if (blocked) {
    summary.textContent = 'Local ZeroPOD safety limit reached. Publishing is blocked until a tracked slot opens.';
    resetLabel.textContent = nextSlotAt ? `Next tracked slot: ${new Date(nextSlotAt).toLocaleString()}` : 'Waiting for a slot';
    countdown.textContent = formatCountdown(nextSlotAt);
    caption.textContent = 'until next tracked slot';
  } else {
    summary.textContent = `${remaining} locally tracked upload slots remain in the rolling 24-hour window.`;
    resetLabel.textContent = nextSlotAt ? `Oldest tracked upload ages out: ${new Date(nextSlotAt).toLocaleString()}` : 'Rolling 24-hour window';
    countdown.textContent = formatCountdown(nextSlotAt);
    caption.textContent = 'oldest slot refresh';
  }
}

async function refreshRedbubbleUsage() {
  try {
    await readRedbubbleUsage();
    renderRedbubbleUsage();
  } catch (error) {
    const card = ensureLimitCard();
    if (card) {
      const summary = document.getElementById('redbubbleLimitSummary');
      if (summary) summary.textContent = `Upload tracker unavailable: ${error.message || error}`;
    }
  }
}

function startRedbubbleLimitTimers() {
  if (!redbubbleRefreshTimer) redbubbleRefreshTimer = setInterval(refreshRedbubbleUsage, 30000);
  if (!redbubbleClockTimer) redbubbleClockTimer = setInterval(() => {
    if (redbubbleUsage.nextSlotAt && redbubbleUsage.nextSlotAt <= Date.now()) refreshRedbubbleUsage();
    else renderRedbubbleUsage();
  }, 1000);
}

const publishButton = document.getElementById('publishRedbubble');
if (publishButton) {
  publishButton.addEventListener('click', (event) => {
    if (!redbubbleUsage.blocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = redbubbleUsage.nextSlotAt ? new Date(redbubbleUsage.nextSlotAt).toLocaleString() : 'later';
    alert(`ZeroPOD has tracked ${REDBUBBLE_LIMIT} successful Redbubble publishes in the last 24 hours. The next tracked slot opens around ${next}. If Redbubble itself still shows an upload-limit warning after that, wait until Redbubble's warning disappears.`);
  }, true);
}

window.addEventListener('focus', refreshRedbubbleUsage);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshRedbubbleUsage(); });
refreshRedbubbleUsage();
startRedbubbleLimitTimers();
