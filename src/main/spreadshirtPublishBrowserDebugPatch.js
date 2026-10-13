const { feature } = require('./spreadshirtAlphaIpc');
const { showAutomationWindow } = require('./chromeDockPatch');

const previousPublish = feature.publish.bind(feature);

// Diagnostic visibility must never be sticky across ordinary app/tab activity.
feature.sessions.setAutomationWindowVisible?.('spreadshirt', false);

feature.publish = async function publishWithVisibleSpreadshirtBrowser(projectId) {
  // Diagnostic-only wrapper: make the existing Spreadshirt automation Chrome window
  // visible only while the established final-publish flow runs. No publish behavior,
  // selectors, placement, metadata, verification, or retry logic is changed here.
  this.sessions.setAutomationWindowVisible?.('spreadshirt', true);

  const { page } = await this.sessions.ensureService('spreadshirt');
  await showAutomationWindow(page);
  await page.bringToFront().catch(() => {});

  try {
    this.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: 'Diagnostic: Spreadshirt browser is visible during Pass · Publish.'
    });
  } catch {}

  try {
    return await previousPublish(projectId);
  } finally {
    // Clear the diagnostic lease immediately after this one publish attempt so
    // opening ZeroPOD, revisiting the Spreadshirt tab, Test Session, Resume, etc.
    // all return to the normal hidden/off-screen automation browser behavior.
    this.sessions.setAutomationWindowVisible?.('spreadshirt', false);
  }
};
