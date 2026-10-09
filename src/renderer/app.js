const navButtons = document.querySelectorAll('.nav');
const views = document.querySelectorAll('.view');
const serviceOrder = ['chatgpt', 'vectorizer', 'redbubble'];

function setView(id) {
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  views.forEach((view) => view.classList.toggle('active-view', view.id === id));
}

navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

function formatDate(value) {
  if (!value) return 'Never';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

async function renderConnections() {
  const statuses = await window.zeroPOD.connections.list();
  const root = document.getElementById('connectionCards');
  root.innerHTML = '';

  for (const id of serviceOrder) {
    const service = statuses[id];
    const card = document.createElement('article');
    card.className = 'connection-card';
    card.innerHTML = `
      <div>
        <div class="service-name">${service.name}</div>
        <div class="status ${service.connected ? 'connected' : ''}">${service.connected ? 'Session saved locally' : 'Not connected'}</div>
        <div class="last-seen">Last session: ${formatDate(service.lastConnectedAt)}</div>
      </div>
      <div class="button-row">
        <button class="login" data-id="${id}">${service.connected ? 'Open / Reconnect' : 'Login'}</button>
        <button class="logout secondary" data-id="${id}" ${service.connected ? '' : 'disabled'}>Logout</button>
      </div>`;
    root.appendChild(card);
  }

  root.querySelectorAll('.login').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Opening…';
    try {
      await window.zeroPOD.connections.login(button.dataset.id);
    } catch (error) {
      alert(`Could not open login window: ${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Open / Reconnect';
    }
  }));

  root.querySelectorAll('.logout').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Clear this local ZeroPOD browser session? You will need to sign in again.')) return;
    await window.zeroPOD.connections.logout(button.dataset.id);
    await renderConnections();
  }));
}

async function renderRules() {
  const rules = await window.zeroPOD.pod.rules();
  document.getElementById('podRules').innerHTML = rules.map((rule) => `<li>${rule}</li>`).join('');
}

document.getElementById('chooseReference').addEventListener('click', async () => {
  const file = await window.zeroPOD.files.chooseReference();
  if (file) document.getElementById('referencePath').value = file;
});

document.getElementById('startGeneration').addEventListener('click', () => {
  const reference = document.getElementById('referencePath').value.trim();
  const sourceUrl = document.getElementById('sourceUrl').value.trim();
  const status = document.getElementById('generationStatus');
  if (!reference) {
    status.textContent = 'Choose a reference image first.';
    return;
  }
  status.textContent = sourceUrl
    ? 'Project input is ready. ChatGPT generation automation is the next stage being wired.'
    : 'Reference is ready. You can continue without a source URL; ChatGPT automation is the next stage being wired.';
});

document.getElementById('rejectDesign').addEventListener('click', () => {
  document.getElementById('generationStatus').textContent = 'Design rejected. Regeneration will preserve your permanent rules and include the review notes.';
  setView('create');
});

document.getElementById('passDesign').addEventListener('click', () => {
  alert('Passed. ZeroPOD will continue to metadata, vectorization, export, then the Redbubble queue once those stages are connected.');
});

renderConnections();
renderRules();
