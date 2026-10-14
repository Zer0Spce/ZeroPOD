const { feature } = require('./spreadshirtAlphaIpc');
const { showAutomationWindow } = require('./chromeDockPatch');

const previousPrepare = feature.prepare.bind(feature);
const previousPublish = feature.publish.bind(feature);

function minimizeZeroPod(featureInstance) {
  try {
    const win = featureInstance.sessions?.__zeroPodHostWindow;
    if (win && !win.isDestroyed?.()) win.minimize?.();
  } catch {}
}

async function focusSpreadshirt(featureInstance, page) {
  if (typeof featureInstance.sessions.focusAutomationWindow === 'function') {
    return featureInstance.sessions.focusAutomationWindow('spreadshirt', page).catch(() => null);
  }
  await showAutomationWindow(page).catch(() => {});
  await page.bringToFront().catch(() => {});
  return null;
}

async function keepSpreadshirtVisible(featureInstance, projectId, label, action) {
  featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', true);
  const { page } = await featureInstance.sessions.ensureService('spreadshirt');
  minimizeZeroPod(featureInstance);
  await focusSpreadshirt(featureInstance, page);

  try {
    featureInstance.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: `Diagnostic: Spreadshirt browser forced to the Windows foreground for ${label}.`
    });
  } catch {}

  // CDP bringToFront only switches Chrome tabs; it does not raise the native
  // Windows Chrome window. Re-assert native foreground while the automated stage
  // is running so a validation error cannot remain hidden behind ZeroPOD.
  let focusing = false;
  const foregroundTimer = setInterval(() => {
    if (focusing) return;
    focusing = true;
    focusSpreadshirt(featureInstance, page)
      .catch(() => {})
      .finally(() => { focusing = false; });
  }, 1100);

  try {
    return await action();
  } finally {
    clearInterval(foregroundTimer);
    featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', false);
    // Leave Chrome visible AND raise the native window one final time. This lets
    // the user inspect/click the exact Spreadshirt result after success or error.
    await focusSpreadshirt(featureInstance, page);
  }
}

feature.prepare = async function prepareWithFullVisibleSpreadshirt(projectId) {
  return keepSpreadshirtVisible(this, projectId, 'the complete upload / product / metadata preparation', () => previousPrepare(projectId));
};

feature.publish = async function publishWithFullVisibleSpreadshirt(projectId) {
  return keepSpreadshirtVisible(this, projectId, 'the complete final publish attempt', () => previousPublish(projectId));
};
