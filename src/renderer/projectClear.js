(() => {
  const button = document.getElementById('clearProjects');
  const api = window.zeroPOD?.projects;
  if (!button || !api?.clearAll) return;

  function plural(value, singular, pluralForm = `${singular}s`) {
    return `${value} ${value === 1 ? singular : pluralForm}`;
  }

  button.addEventListener('click', async () => {
    let usage = null;
    try { usage = await window.zeroPOD.redbubble?.dailyUsage?.(); } catch {}

    const trackerLine = usage
      ? `ZeroPOD currently tracks ${usage.count} / ${usage.limit} successful Redbubble publishes in the last 24 hours.`
      : 'ZeroPOD could not read the current Redbubble upload tracker before this deletion.';

    const accepted = confirm(
      `WARNING — CLEAR ALL PROJECTS\n\n` +
      `This permanently deletes every ZeroPOD project folder, including generated artwork, metadata, project history, archived projects, and published-project records.\n\n` +
      `${trackerLine}\n\n` +
      `The Redbubble 30-upload tracker is calculated from publish records stored inside these projects. Clearing Projects can make ZeroPOD UNDERCOUNT uploads from the current rolling 24-hour period and may show upload slots as available even when Redbubble still considers the account at its limit. Redbubble's own warning remains the source of truth.\n\n` +
      `Automation rows that still depend on project data must be completed, skipped, or removed first.\n\n` +
      `This action cannot be undone. Continue?`
    );
    if (!accepted) return;

    const typed = prompt(
      'FINAL CONFIRMATION\n\nType CLEAR PROJECTS exactly to permanently delete all ZeroPOD projects.'
    );
    if (typed !== 'CLEAR PROJECTS') {
      alert('Clear Projects canceled. Nothing was deleted.');
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Clearing…';

    try {
      const result = await api.clearAll({ confirmation: 'CLEAR PROJECTS' });
      try { currentProjectId = null; } catch {}
      try { projectFilter = 'all'; } catch {}

      document.querySelectorAll('.project-filter').forEach((item) => {
        item.classList.toggle('active-filter', item.dataset.filter === 'all');
      });

      if (typeof renderProjects === 'function') await renderProjects();
      if (typeof renderDashboard === 'function') await renderDashboard();
      if (typeof refreshRedbubbleUsage === 'function') await refreshRedbubbleUsage();

      const trackerImpact = result.recentPublishedRecordsRemoved
        ? ` ${plural(result.recentPublishedRecordsRemoved, 'publish record')} from the current 24-hour tracking window ${result.recentPublishedRecordsRemoved === 1 ? 'was' : 'were'} also removed, so use Redbubble itself to confirm when uploads are available.`
        : '';
      alert(`Cleared ${plural(result.deleted, 'project')}.${trackerImpact}`);
    } catch (error) {
      alert(`Projects were not cleared: ${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
})();
