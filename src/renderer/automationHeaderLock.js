(() => {
  if (window.__zeroPODAutomationHeaderLockInstalled) return;
  window.__zeroPODAutomationHeaderLockInstalled = true;

  const FINAL_TEXT = 'Queue up to 50 image + source URL jobs. Choose Redbubble, Spreadshirt, or both per row; ZeroPOD publishes only to the selected POD destination(s).';
  let observer = null;
  let observedNode = null;

  function enforce() {
    const intro = document.querySelector('#automation .az-head .muted');
    if (!intro) return false;

    if (intro.textContent !== FINAL_TEXT) intro.textContent = FINAL_TEXT;

    if (observedNode !== intro) {
      observer?.disconnect();
      observedNode = intro;
      observer = new MutationObserver(() => {
        if (intro.textContent !== FINAL_TEXT) intro.textContent = FINAL_TEXT;
      });
      observer.observe(intro, { childList: true, characterData: true, subtree: true });
    }
    return true;
  }

  enforce();

  let attempts = 0;
  const startup = setInterval(() => {
    attempts += 1;
    enforce();
    if (attempts >= 40) clearInterval(startup);
  }, 100);

  const nav = document.querySelector('.nav[data-view="automation"]');
  nav?.addEventListener('click', () => queueMicrotask(enforce));

  window.addEventListener('beforeunload', () => {
    clearInterval(startup);
    observer?.disconnect();
  });
})();
