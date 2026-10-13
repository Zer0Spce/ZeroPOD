const { feature } = require('./spreadshirtAlphaIpc');
const { showAutomationWindow } = require('./chromeDockPatch');

const previousPublish = feature.publish.bind(feature);

feature.publish = async function publishWithVisibleSpreadshirtBrowser(projectId) {
  // Diagnostic-only wrapper: make the existing Spreadshirt automation Chrome window
  // visible before the established final-publish flow runs. No publish behavior,
  // selectors, placement, metadata, verification, or retry logic is changed here.
  this.sessions.__zeroPodVisibleAutomationServices ||= new Set();
  this.sessions.__zeroPodVisibleAutomationServices.add('spreadshirt');

  const { page } = await this.sessions.ensureService('spreadshirt');
  await showAutomationWindow(page);
  await page.bringToFront().catch(() => {});

  try {
    this.projects.addActivity(projectId, {
      type: 'spreadshirt',
      label: 'Diagnostic: Spreadshirt browser is visible during Pass · Publish.'
    });
  } catch {}

  return previousPublish(projectId);
};
