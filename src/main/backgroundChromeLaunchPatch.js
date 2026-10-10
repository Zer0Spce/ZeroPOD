const childProcess = require('child_process');

// Automation Chrome should never jump in front of ZeroPOD. Inject an off-screen
// window position only for Chrome processes that expose a remote-debugging port.
// Native Connections -> Login Chrome has no remote-debugging flag and remains
// completely visible for manual sign-in / CAPTCHA / 2FA.
if (!childProcess.__zeroPodBackgroundChromePatched) {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function zeroPodBackgroundSpawn(file, args = [], options = {}) {
    const list = Array.isArray(args) ? [...args] : args;
    const isChrome = /(?:^|[\\/])chrome\.exe$/i.test(String(file || ''));
    const isAutomation = isChrome && Array.isArray(list) && list.some((arg) => /^--remote-debugging-port=/i.test(String(arg)));

    if (isAutomation) {
      const hasPosition = list.some((arg) => /^--window-position=/i.test(String(arg)));
      const hasSize = list.some((arg) => /^--window-size=/i.test(String(arg)));
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
