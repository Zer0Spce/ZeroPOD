(() => {
  function patch() {
    const section = document.getElementById('spreadshirtAlpha');
    if (!section) return false;
    section.querySelectorAll('.ss-step').forEach((step) => {
      const title = step.querySelector('strong')?.textContent || '';
      if (!/Spreadshirt PNG/i.test(title)) return;
      const copy = step.querySelector('.ss-small');
      if (copy) copy.textContent = 'Uses the same proven transparent 4500×5400 ZeroPOD export as the regular Workflow.';
    });
    const artwork = document.getElementById('ssArtworkInfo');
    if (artwork && /No Spreadshirt PNG/i.test(artwork.textContent || '')) artwork.textContent = 'No 4500×5400 ZeroPOD PNG exported yet.';
    return true;
  }

  if (patch()) return;
  const timer = setInterval(() => { if (patch()) clearInterval(timer); }, 250);
  setTimeout(() => clearInterval(timer), 10000);
})();
