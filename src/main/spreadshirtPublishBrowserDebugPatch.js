const { feature } = require('./spreadshirtAlphaIpc');
const { keepAutomationWindowOffscreen } = require('./chromeDockPatch');

const previousPrepare = feature.prepare.bind(feature);
const previousPublish = feature.publish.bind(feature);

async function keepSpreadshirtHidden(featureInstance, projectId, action) {
  featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', false);
  const { page } = await featureInstance.sessions.ensureService('spreadshirt');
  await keepAutomationWindowOffscreen(page).catch(() => {});

  try {
    return await action();
  } finally {
    featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', false);
    await keepAutomationWindowOffscreen(page).catch(() => {});
  }
}

feature.prepare = async function prepareWithHiddenSpreadshirt(projectId) {
  return keepSpreadshirtHidden(this, projectId, () => previousPrepare(projectId));
};

feature.publish = async function publishWithHiddenSpreadshirt(projectId) {
  return keepSpreadshirtHidden(this, projectId, () => previousPublish(projectId));
};
