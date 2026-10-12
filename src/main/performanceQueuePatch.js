const { AutomationQueueController } = require('./automationQueueController');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The reliability queue used multi-second sleeps between every transition. Keep
// the exact same one-row-at-a-time safety model, but poll quickly enough to move
// to the next ready stage as soon as project state changes.
AutomationQueueController.prototype.runLoop = async function runLoopFastTransitions() {
  while (!this.stopRequested) {
    const data = this.store.read();
    if (data.state === 'stopped') break;
    if (data.state === 'paused') {
      await wait(300);
      continue;
    }

    await this.syncRows();
    const row = this.findRunnableRow();
    if (!row) {
      await wait(500);
      continue;
    }

    try {
      await this.processRow(row);
    } catch (error) {
      const latestData = this.store.read();
      const forceStopped = latestData.state === 'stopped'
        || error?.code === 'ZEROPOD_FORCE_STOP'
        || /stopped by user with force stop/i.test(String(error?.message || ''));

      if (forceStopped) {
        const latest = latestData.rows.find((item) => item.id === row.id) || row;
        this.store.updateRow(row.id, {
          status: latest.projectId ? 'ready' : 'pending',
          step: 'Force stopped · ready to retry',
          lastError: null
        });
      } else {
        this.store.updateRow(row.id, {
          status: 'needs-attention',
          step: 'Error',
          lastError: error.message || String(error)
        });
      }
    }

    // Yield to Electron/Playwright without adding a user-visible stage delay.
    await wait(60);
  }
};

// Detect ChatGPT's new assistant turn four times faster than the legacy 700 ms
// poll. This changes only observation latency; generation itself remains untouched.
ChatGPTController.prototype.waitForNewAssistantResponse = async function waitForNewAssistantResponseFast(page, baseline, onProgress) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    await this.assertNoHumanGate(page);
    const messages = page.locator('[data-message-author-role="assistant"]');
    const count = await messages.count();
    if (count > baseline.count) {
      const newest = messages.nth(count - 1);
      const id = await newest.evaluate((node, index) => node.getAttribute('data-message-id')
        || node.closest('[data-message-id]')?.getAttribute('data-message-id')
        || `assistant-${index}`).catch(() => null);
      if (!id || !baseline.ids.has(id)) {
        if (typeof onProgress === 'function') onProgress('Image generation in progress');
        return newest;
      }
    }
    await wait(180);
  }
  throw new Error('ChatGPT did not create a new assistant response for the generation request.');
};

module.exports = {};
