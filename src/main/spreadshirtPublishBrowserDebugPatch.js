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

async function keepSpreadshirtVisible(featureInstance, projectId, label, action) {
  featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', true);
  const { page } = await featureInstance.sessions.ensureService('spreadshirt');
  minimizeZeroPod(featureInstance);
  await showAutomationWindow(page);
  await page.bringToFront().catch(() => {});

  try {
    featureInstance.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: `Diagnostic: Spreadshirt browser kept in front for ${label}.`
    });
  } catch {}

  const foregroundTimer = setInterval(() => {
    showAutomationWindow(page).catch(() => {});
    page.bringToFront().catch(() => {});
  }, 450);

  try {
    return await action();
  } finally {
    clearInterval(foregroundTimer);
    featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', false);
    // Deliberately leave the Spreadshirt Chrome window on-screen at the end of
    // each stage. ZeroPOD stays minimized until the user chooses to return to it,
    // so the live Spreadshirt result cannot be hidden by the renderer.
    await showAutomationWindow(page).catch(() => {});
    await page.bringToFront().catch(() => {});
  }
}

feature.prepare = async function prepareWithFullVisibleSpreadshirt(projectId) {
  return keepSpreadshirtVisible(this, projectId, 'the complete upload / product / metadata preparation', () => previousPrepare(projectId));
};

feature.publish = async function publishWithFullVisibleSpreadshirt(projectId) {
  return keepSpreadshirtVisible(this, projectId, 'the complete final publish attempt', () => previousPublish(projectId));
};
