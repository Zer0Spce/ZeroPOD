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

    const localCount = Number(usage?.localCount ?? usage?.count ?? 0);
    const trackerLine = usage
      ? `ZeroPOD currently has ${localCount} successful Redbubble publishes recorded in the last 24 hours. This count is informational only.`
      : 'ZeroPOD could not read the current local Redbubble publish history before this deletion.';

    const detectedLine = usage?.blocked
      ? `Redbubble upload-limit status is currently DETECTED from Redbubble's own page. That detection state is stored separately from Projects and will not be erased by Clear Projects.`
      : `No Redbubble upload-limit page is currently marked as detected.`;

    const accepted = confirm(
      `WARNING — CLEAR ALL PROJECTS\n\n` +
      `This permanently deletes every ZeroPOD project folder, including generated artwork, metadata, project history, archived projects, and published-project records.\n\n` +
      `${trackerLine}\n${detectedLine}\n\n` +
      `Clearing Projects will erase the local publish-history count shown on the dashboard, so that informational number may become inaccurate for the current 24-hour period. It does NOT reset Redbubble's real upload limit and it does NOT make ZeroPOD assume uploads are available. ZeroPOD determines the actual limit only from Redbubble's own “exceeded your upload limit” page/message.\n\n` +
      `Paused/stopped Automation rows linked to Projects will be safely unlinked and reset so they can run again from their original image + Amazon/source URL. A currently running Automation/workflow step must finish or be paused first.\n\n` +
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
      if (typeof renderAutomation === 'function') await renderAutomation();
      if (typeof renderAutomationList === 'function') await renderAutomationList();
      if (typeof window.refreshRedbubbleUsage === 'function') await window.refreshRedbubbleUsage();

      const historyImpact = result.recentPublishedRecordsRemoved
        ? ` ${plural(result.recentPublishedRecordsRemoved, 'publish record')} from the current 24-hour local history ${result.recentPublishedRecordsRemoved === 1 ? 'was' : 'were'} also removed. This affects only the informational count; Redbubble page detection remains the source of truth.`
        : '';
      const queueImpact = result.automationRowsReset
        ? ` ${plural(result.automationRowsReset, 'Automation row')} ${result.automationRowsReset === 1 ? 'was' : 'were'} safely reset to use the original input again.`
        : '';
      alert(`Cleared ${plural(result.deleted, 'project')}.${queueImpact}${historyImpact}`);
    } catch (error) {
      alert(`Projects were not cleared: ${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
})();
