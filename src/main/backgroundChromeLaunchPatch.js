const childProcess = require('child_process');

// Keep every automation Chrome fully rendered but hidden/off-screen so it never
// steals focus from ZeroPOD. Connections -> Login uses the normal visible browser
// handoff and is intentionally not affected by this automation-only patch.
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
      if (!hasSize) list.push('--window-size=1280,900');
      if (!list.some((arg) => String(arg) === '--no-first-run')) list.push('--no-first-run');
      return originalSpawn.call(childProcess, file, list, { ...options, windowsHide: true });
    }

    return originalSpawn.call(childProcess, file, args, options);
  };
  childProcess.__zeroPodBackgroundChromePatched = true;
}

module.exports = {};
