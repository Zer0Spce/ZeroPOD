const { RedbubbleController } = require('./redbubbleController');

const originalPrepare = RedbubbleController.prototype.prepare;

RedbubbleController.prototype.prepare = async function prepareWithWideRedbubble(projectId) {
  let wideStarted = false;
  try {
    if (typeof this.sessions?.beginWideService === 'function') {
      await this.sessions.beginWideService('redbubble');
      wideStarted = true;
    }
    return await originalPrepare.call(this, projectId);
  } finally {
    if (wideStarted && typeof this.sessions?.endWideService === 'function') {
      await this.sessions.endWideService('redbubble').catch(() => {});
    }
  }
};

module.exports = {};
