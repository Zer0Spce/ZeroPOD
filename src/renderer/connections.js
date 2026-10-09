function connectionStatusText(service) {
  const labels = {
    verified: 'Verified',
    'needs-login': 'Needs Login',
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

    loginButton.textContent = service.saved ? 'Open Login Browser' : 'Open Login Browser';
    loginButton.title = 'Opens a normal Microsoft Edge window. Finish Google/email/password/2FA there, then click Test Session.';

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
      alert(`${serviceId}: login is still required. Click Open Login Browser, finish signing in in normal Microsoft Edge, then click Test Session again.`);
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
  note.innerHTML = '<strong>Google sign-in compatibility</strong><p class="muted">ZeroPOD opens a normal Microsoft Edge window for login and does not attach automation until you press Test Session. Complete Google, email/password, CAPTCHA, or 2FA normally in Edge.</p>';
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
      const failed = result.needsLogin || [];
      if (failed.length) alert(`Login required: ${failed.join(', ')}. Open each Login Browser and finish sign-in in normal Edge first.`);
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
  if (document.getElementById('connections')?.classList.contains('active-view')) {
    decorateConnections().catch(() => {});
  }
}, 3000);

decorateConnections().catch(() => {});
