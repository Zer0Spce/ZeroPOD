function connectionStatusText(service) {
  const labels = {
    verified: 'Verified',
    'needs-login': 'Needs Login',
    'human-verification': 'Human Verification Required',
    unknown: service.saved ? 'Saved / Unverified' : 'Not configured',
    'not-configured': 'Not configured'
  };
  return labels[service.authStatus] || 'Unknown';
}

async function decorateConnections() {
  const root = document.getElementById('connectionCards');
  if (!root || !window.zeroPOD?.connections) return;

  const statuses = await window.zeroPOD.connections.list();
  root.querySelectorAll('.connection-card').forEach((card) => {
    const loginButton = card.querySelector('.login[data-id]');
    if (!loginButton) return;
    const serviceId = loginButton.dataset.id;
    const service = statuses[serviceId];
    if (!service) return;

    loginButton.textContent = 'Open Login Browser';
    loginButton.title = 'Opens ZeroPOD’s dedicated normal Microsoft Edge profile for manual login and verification.';

    const logoutButton = card.querySelector('.logout[data-id]');
    if (logoutButton) logoutButton.disabled = !service.saved;

    const status = card.querySelector('.status');
    if (status) {
      status.textContent = connectionStatusText(service);
      status.classList.toggle('connected', service.authStatus === 'verified');
      status.dataset.authStatus = service.authStatus;
    }

    let detail = card.querySelector('.connection-verification');
    if (!detail) {
      detail = document.createElement('div');
      detail.className = 'last-seen connection-verification';
      status?.insertAdjacentElement('afterend', detail);
    }
    detail.textContent = service.verificationMessage || (service.saved
      ? 'Saved Edge profile. Click Test Session to verify login.'
      : 'Open Login Browser. Sign in in normal Microsoft Edge, then return here and click Test Session.');

    const actions = card.querySelector('.button-row');
    if (actions && !actions.querySelector('.test-session')) {
      const button = document.createElement('button');
      button.className = 'test-session secondary';
      button.dataset.id = serviceId;
      button.textContent = 'Test Session';
      actions.insertBefore(button, actions.querySelector('.logout'));
    }
  });
}

async function testOneConnection(serviceId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Testing…';
  try {
    const result = await window.zeroPOD.connections.test(serviceId);
    if (result.status === 'needs-login') {
      alert(`${serviceId}: login is still required. Click Open Login Browser, finish signing in, close that dedicated Edge window if it remains open, then click Test Session again.`);
    } else if (result.status === 'human-verification') {
      alert(`${serviceId}: human verification is required. Complete the challenge manually in the open browser, then click Test Session again. ZeroPOD will not automate or bypass verification.`);
    }
  } catch (error) {
    alert(`Could not test ${serviceId}: ${error.message || error}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
    await decorateConnections();
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('.test-session');
  if (!button) return;
  await testOneConnection(button.dataset.id, button);
});

const connectionRoot = document.getElementById('connectionCards');
if (connectionRoot) {
  const observer = new MutationObserver(() => decorateConnections().catch(() => {}));
  observer.observe(connectionRoot, { childList: true, subtree: true });
}

const connectionSection = document.getElementById('connections');
if (connectionSection && !document.getElementById('testAllConnections')) {
  const note = document.createElement('div');
  note.className = 'panel connection-login-note';
  note.innerHTML = '<strong>Login & verification</strong><p class="muted">ZeroPOD uses a dedicated normal Microsoft Edge profile for login. Complete Google/email/password, CAPTCHA, Cloudflare, or 2FA manually. When you press Test Session, ZeroPOD closes only that dedicated profile window before handing the saved session to automation.</p>';
  const paragraph = connectionSection.querySelector('p.muted');
  paragraph?.insertAdjacentElement('afterend', note);

  const button = document.createElement('button');
  button.id = 'testAllConnections';
  button.className = 'secondary';
  button.textContent = 'Test All Sessions';
  note.insertAdjacentElement('afterend', button);

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Testing all…';
    try {
      const result = await window.zeroPOD.connections.preflight();
      const blocked = result.blocked || result.needsLogin || [];
      if (blocked.length) alert(`Sessions needing attention: ${blocked.join(', ')}. Complete login/verification manually before retrying.`);
    } catch (error) {
      alert(`Connection preflight failed: ${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Test All Sessions';
      await decorateConnections();
    }
  });
}

setInterval(() => {
  if (document.getElementById('connections')?.classList.contains('active-view')) decorateConnections().catch(() => {});
}, 3000);

decorateConnections().catch(() => {});
