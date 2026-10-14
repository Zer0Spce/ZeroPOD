const { feature } = require('./spreadshirtAlphaIpc');
const { keepAutomationWindowOffscreen } = require('./chromeDockPatch');
const { hideChromeWindowByProfile, startChromeHideLease } = require('./spreadshirtTrueHiddenChromePatch');

const previousPrepare = feature.prepare.bind(feature);
const previousPublish = feature.publish.bind(feature);

async function keepSpreadshirtHidden(featureInstance, projectId, action) {
  featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', false);
  const profilePath = featureInstance.sessions.getProfilePath('spreadshirt');
  const nativeLease = startChromeHideLease(profilePath);
  hideChromeWindowByProfile(profilePath, 6000).catch(() => {});

  const { page } = await featureInstance.sessions.ensureService('spreadshirt');
  await keepAutomationWindowOffscreen(page).catch(() => {});
  await hideChromeWindowByProfile(profilePath).catch(() => {});

  try {
    return await action();
  } finally {
    featureInstance.sessions.setAutomationWindowVisible?.('spreadshirt', false);
    await keepAutomationWindowOffscreen(page).catch(() => {});
    await hideChromeWindowByProfile(profilePath).catch(() => {});
    nativeLease.stop();
  }
}

feature.prepare = async function prepareWithHiddenSpreadshirt(projectId) {
  return keepSpreadshirtHidden(this, projectId, () => previousPrepare(projectId));
};

feature.publish = async function publishWithHiddenSpreadshirt(projectId) {
  return keepSpreadshirtHidden(this, projectId, () => previousPublish(projectId));
};
