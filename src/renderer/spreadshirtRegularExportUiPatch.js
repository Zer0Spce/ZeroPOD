(() => {
  function patch() {
    const section = document.getElementById('spreadshirtAlpha');
    if (!section) return false;
    section.querySelectorAll('.ss-step').forEach((step) => {
      const title = step.querySelector('strong')?.textContent || '';
      if (!/Spreadshirt PNG/i.test(title)) return;
      const copy = step.querySelector('.ss-small');
      if (copy) copy.textContent = 'Keeps the normal transparent 4500×5400 ZeroPOD export, then automatically makes a Spreadshirt-ready upload copy (max 4000×4000, 10 MB, 200 dpi).';
    });
    const artwork = document.getElementById('ssArtworkInfo');
    if (artwork && /No Spreadshirt PNG/i.test(artwork.textContent || '')) artwork.textContent = 'No Spreadshirt-ready upload copy exported yet.';
    return true;
  }

  if (patch()) return;
  const timer = setInterval(() => { if (patch()) clearInterval(timer); }, 250);
  setTimeout(() => clearInterval(timer), 10000);
})();
