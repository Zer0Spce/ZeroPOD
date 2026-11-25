const { feature } = require('./spreadshirtAlphaIpc');

const previousCheck = feature.check.bind(feature);

function looksLikeLoginError(error) {
  return /login is required|sign in|log in|needs login|register/i.test(String(error?.message || error || ''));
}

feature.check = async function checkWithLiveSpreadshirtSession(projectId) {
  // The encrypted connection state is only a cache. Automation may start hours
  // after the last manual Test Session, so prove the current saved profile against
  // the real Marketplace Designs page before deciding that the gate is blocked.
  try {
    this.sessions.setAutomationWindowVisible?.('spreadshirt', false);
    const { page } = await this.sessions.ensureService('spreadshirt');

    // openDesigns is a stronger authentication proof than a stale saved flag: it
    // runs Spreadshirt's signed-in checks and waits for the authenticated Designs
    // surface (including the dashboard -> Designs recovery path).
    await this.openDesigns(page);

    this.sessions.updateState('spreadshirt', {
      profileCreated: true,
      authStatus: 'verified',
      lastVerifiedAt: new Date().toISOString(),
      verificationMessage: 'Authenticated Spreadshirt Marketplace Designs UI was detected automatically during the gate check.'
    });
  } catch (error) {
    // Only downgrade the saved session when Spreadshirt itself clearly shows a
    // login state. A route/network hiccup must not erase a previously verified
    // account and create a false "not verified" loop.
    if (looksLikeLoginError(error)) {
      this.sessions.updateState('spreadshirt', {
        profileCreated: true,
        authStatus: 'needs-login',
        lastVerifiedAt: new Date().toISOString(),
        verificationMessage: error.message || String(error)
      });
    }
  }

  return previousCheck(projectId);
};

module.exports = { looksLikeLoginError };
