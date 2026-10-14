(() => {
  if (window.__zeroPODExtraConnectionsInstalled) return;
  window.__zeroPODExtraConnectionsInstalled = true;

  const EXTRA = [
    { id: 'spreadshirt', label: 'Spreadshirt', note: 'Used by the Spreadshirt tab and Automation uploads.' },
    { id: 'flyingResearch', label: 'Flying Research / Flying Upload', note: 'Used by Flying Research and its send/upload actions.' }
  ];
  let busy = false;
  let timer = null;
  let observer = null;

  function formatDate(value) {
    if (!value) return 'Never';
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
  }

  function statusText(service) {
    const labels = {
      verified: 'Verified',
      'needs-login': 'Needs Login',
      'human-verification': 'Human Verification Required',
      unknown: service?.saved ? 'Saved / Unverified' : 'Not configured',
      'not-configured': 'Not configured'
    };
    return labels[service?.authStatus] || (service?.connected ? 'Verified' : 'Not configured');
  }

  async function login(serviceId, button) {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening…';
    try {
      await window.zeroPOD.connections.login(serviceId);
    } catch (error) {
      alert(`Could not open ${serviceId} login browser: ${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = old;
      await render().catch(() => {});
    }
  }

  async function test(serviceId, button) {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Testing…';
    try {
      const result = await window.zeroPOD.connections.test(serviceId);
      if (result.status === 'needs-login') alert(`${serviceId}: login is still required. Open Login Browser, finish signing in, then Test Session again.`);
      if (result.status === 'human-verification') alert(`${serviceId}: human verification is required. Complete it manually in the login browser, then Test Session again.`);
    } catch (error) {
      alert(`Could not test ${serviceId}: ${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = old;
      await render().catch(() => {});
    }
  }

  async function logout(serviceId, button) {
    if (!confirm(`Clear the saved ${serviceId} browser session? You will need to sign in again.`)) return;
    button.disabled = true;
    try { await window.zeroPOD.connections.logout(serviceId); }
    catch (error) { alert(`Could not clear ${serviceId}: ${error.message || error}`); }
    finally { button.disabled = false; await render().catch(() => {}); }
  }

  function wireCard(card) {
    if (card.dataset.extraWired === '1') return;
    card.dataset.extraWired = '1';
    card.querySelector('.extra-login')?.addEventListener('click', (event) => login(event.currentTarget.dataset.id, event.currentTarget));
    card.querySelector('.extra-test')?.addEventListener('click', (event) => test(event.currentTarget.dataset.id, event.currentTarget));
    card.querySelector('.extra-logout')?.addEventListener('click', (event) => logout(event.currentTarget.dataset.id, event.currentTarget));
  }

  async function render() {
    if (busy || !window.zeroPOD?.connections) return;
    const root = document.getElementById('connectionCards');
    if (!root) return;
    busy = true;
    try {
      const statuses = await window.zeroPOD.connections.list();
      for (const config of EXTRA) {
        const service = statuses[config.id];
        if (!service) continue;
        let card = root.querySelector(`.connection-card[data-extra-service="${config.id}"]`);
        if (!card) {
          card = document.createElement('article');
          card.className = 'connection-card';
          card.dataset.extraService = config.id;
          root.appendChild(card);
        }
        const verified = service.authStatus === 'verified' || service.connected;
        card.innerHTML = `
          <div>
            <div class="service-name">${config.label}</div>
            <div class="status ${verified ? 'connected' : ''}">${statusText(service)}</div>
            <div class="last-seen">${config.note}</div>
            <div class="last-seen connection-verification">${service.verificationMessage || `Last session: ${formatDate(service.lastConnectedAt)}`}</div>
          </div>
          <div class="button-row">
            <button class="extra-login" data-id="${config.id}">Open Login Browser</button>
            <button class="extra-test secondary" data-id="${config.id}">Test Session</button>
            <button class="extra-logout secondary" data-id="${config.id}" ${service.saved ? '' : 'disabled'}>Logout</button>
          </div>`;
        wireCard(card);
      }

      const section = document.getElementById('connections');
      const note = section?.querySelector('.connection-login-note p');
      if (note) note.textContent = 'ZeroPOD uses dedicated browser profiles for ChatGPT, Vectorizer.ai, Redbubble, Spreadshirt, and Flying Research. Complete passwords, CAPTCHA, Cloudflare, or 2FA manually in the login browser, then use Test Session.';
    } finally {
      busy = false;
    }
  }

  function install() {
    render().catch(() => {});
    const root = document.getElementById('connectionCards');
    if (root) {
      observer = new MutationObserver(() => render().catch(() => {}));
      observer.observe(root, { childList: true });
    }
    timer = setInterval(() => {
      if (document.getElementById('connections')?.classList.contains('active-view')) render().catch(() => {});
    }, 1400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer);
    observer?.disconnect();
  });
})();
