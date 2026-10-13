const { feature } = require('./spreadshirtAlphaIpc');
const { showAutomationWindow } = require('./chromeDockPatch');

const previousPublish = feature.publish.bind(feature);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // Keep Chrome in front during this diagnostic attempt so the Electron host cannot
  // immediately reclaim focus before the user can inspect the live Spreadshirt page.
  // This timer does not interact with Spreadshirt DOM or alter publish behavior.
  const keepVisible = setInterval(() => {
    if (page.isClosed()) return;
    page.bringToFront().catch(() => {});
  }, 750);
  keepVisible.unref?.();

  try {
    this.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: 'Diagnostic: Spreadshirt browser is visible during Pass · Publish.'
    });
  } catch {}

  try {
    // Deliberate diagnostic observation window only. The established publish routine
    // starts unchanged after this pause, even when it later short-circuits as already published.
    await wait(5000);
    return await previousPublish(projectId);
  } finally {
    clearInterval(keepVisible);
    // Clear the diagnostic lease immediately after this one publish attempt so
    // opening ZeroPOD, revisiting the Spreadshirt tab, Test Session, Resume, etc.
    // all return to the normal hidden/off-screen automation browser behavior.
    this.sessions.setAutomationWindowVisible?.('spreadshirt', false);
  }
};
