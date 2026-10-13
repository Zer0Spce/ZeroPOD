const childProcess = require('child_process');

// Automation Chrome normally stays off-screen so it never steals focus from
// ZeroPOD. When Spreadshirt explicitly leases a visible automation window for its
// upload/publish diagnostic flow, launch that Chrome window visibly from the start
// instead of spawning it hidden/off-screen and trying to repaint it afterward.
if (!childProcess.__zeroPodBackgroundChromePatched) {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function zeroPodBackgroundSpawn(file, args = [], options = {}) {
    const list = Array.isArray(args) ? [...args] : args;
    const isChrome = /(?:^|[\\/])chrome\.exe$/i.test(String(file || ''));
    const isAutomation = isChrome && Array.isArray(list) && list.some((arg) => /^--remote-debugging-port=/i.test(String(arg)));

    if (isAutomation) {
      const spreadshirtVisible = Boolean(globalThis.__zeroPodVisibleAutomationServices?.has?.('spreadshirt'))
        && list.some((arg) => /partner\.spreadshirt\.com/i.test(String(arg)));
      const hasPosition = list.some((arg) => /^--window-position=/i.test(String(arg)));
      const hasSize = list.some((arg) => /^--window-size=/i.test(String(arg)));

      if (spreadshirtVisible) {
        if (!hasPosition) list.push('--window-position=60,60');
        if (!hasSize) list.push('--window-size=1360,900');
        if (!list.some((arg) => String(arg) === '--no-first-run')) list.push('--no-first-run');
        return originalSpawn.call(childProcess, file, list, { ...options, windowsHide: false });
      }

      if (!hasPosition) list.push('--window-position=-20000,-20000');
      if (!hasSize) list.push('--window-size=1280,860');
      if (!list.some((arg) => String(arg) === '--no-first-run')) list.push('--no-first-run');
      return originalSpawn.call(childProcess, file, list, { ...options, windowsHide: true });
    }

    return originalSpawn.call(childProcess, file, args, options);
  };
  childProcess.__zeroPodBackgroundChromePatched = true;
}

module.exports = {};
