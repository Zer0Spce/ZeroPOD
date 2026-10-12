(() => {
  let clearing = false;

  function plural(value, singular, pluralForm = `${singular}s`) {
    return `${value} ${value === 1 ? singular : pluralForm}`;
  }

  async function handleClearProjects(button) {
    if (clearing) return;
    const api = window.zeroPOD?.projects;
    if (!api?.clearAll) {
      alert('Clear Projects is unavailable in this build. Restart ZeroPOD and try again.');
      return;
    }

    let usage = null;
    try { usage = await window.zeroPOD.redbubble?.dailyUsage?.(); } catch {}

    const localCount = Number(usage?.localCount ?? usage?.count ?? 0);
    const trackerLine = usage
      ? `ZeroPOD currently has ${localCount} successful Redbubble publishes recorded in the last 24 hours. This count is informational only.`
      : 'ZeroPOD could not read the current local Redbubble publish history before this deletion.';

    const detectedLine = usage?.blocked
      ? `Redbubble upload-limit status is currently DETECTED from Redbubble's own page. That detection state is stored separately from Projects and will not be erased by Clear Projects.`
      : `No Redbubble upload-limit page is currently marked as detected.`;

    const accepted = window.confirm(
      `WARNING — CLEAR ALL PROJECTS\n\n` +
      `This permanently deletes every ZeroPOD project folder, including generated artwork, metadata, project history, archived projects, and published-project records.\n\n` +
      `${trackerLine}\n${detectedLine}\n\n` +
      `Clearing Projects will erase the local publish-history count shown on the dashboard, so that informational number may become inaccurate for the current 24-hour period. It does NOT reset Redbubble's real upload limit and it does NOT make ZeroPOD assume uploads are available. ZeroPOD determines the actual limit only from Redbubble's own “exceeded your upload limit” page/message.\n\n` +
      `Paused/stopped Automation rows linked to projects will be safely reset back to their original image + source URL so they are not left pointing at deleted project folders.\n\n` +
      `This action cannot be undone. Continue?`
    );
    if (!accepted) return;

    // Electron in this build does not support window.prompt(). Use a second native
    // confirmation instead so Clear Projects cannot silently fail before IPC runs.
    const finalAccepted = window.confirm(
      `FINAL CONFIRMATION\n\n` +
      `Permanently delete ALL ZeroPOD projects now?\n\n` +
      `This cannot be undone. Choose OK only if you are sure.`
    );
    if (!finalAccepted) {
      alert('Clear Projects canceled. Nothing was deleted.');
      return;
    }

    const originalLabel = button.textContent;
    clearing = true;
    button.disabled = true;
    button.textContent = 'Clearing…';

    try {
      const result = await api.clearAll({ confirmation: 'CLEAR PROJECTS' });
      try { currentProjectId = null; } catch {}
      try { projectFilter = 'all'; } catch {}
      try { localStorage.removeItem('zeropod.unified.activeProject.v1'); } catch {}

      document.querySelectorAll('.project-filter').forEach((item) => {
        item.classList.toggle('active-filter', item.dataset.filter === 'all');
      });

      if (typeof renderProjects === 'function') await renderProjects();
      if (typeof renderDashboard === 'function') await renderDashboard();
      if (typeof refreshAutomationListV2 === 'function') await refreshAutomationListV2().catch(() => {});
      if (typeof window.refreshRedbubbleUsage === 'function') await window.refreshRedbubbleUsage();

      const impacts = [];
      if (result.recentPublishedRecordsRemoved) {
        impacts.push(`${plural(result.recentPublishedRecordsRemoved, 'publish record')} from the current 24-hour local history removed`);
      }
      if (result.automationRowsReset) {
        impacts.push(`${plural(result.automationRowsReset, 'Automation row')} reset to its original input`);
      }
      const suffix = impacts.length ? `\n\n${impacts.join('. ')}.` : '';
      alert(`Cleared ${plural(result.deleted, 'project')}.${suffix}`);
    } catch (error) {
      alert(`Projects were not cleared: ${error.message || error}`);
    } finally {
      clearing = false;
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  // Delegated binding survives Projects view re-renders and any later DOM replacement.
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('#clearProjects');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    handleClearProjects(button).catch((error) => {
      clearing = false;
      button.disabled = false;
      button.textContent = 'Clear Projects';
      alert(`Projects were not cleared: ${error.message || error}`);
    });
  });
})();
