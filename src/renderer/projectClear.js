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
    let publishStats = null;
    try { usage = await window.zeroPOD.redbubble?.dailyUsage?.(); } catch {}
    try { publishStats = await window.zeroPOD.redbubble?.publishStats?.(); } catch {}

    const localCount = Number(publishStats?.last24h ?? usage?.localCount ?? usage?.count ?? 0);
    const totalPublished = Number(publishStats?.totalPublished ?? 0);
    const trackerLine = publishStats
      ? `ZeroPOD's persistent publish ledger currently records ${localCount} successful publishes in the last 24 hours and ${totalPublished} total published works.`
      : usage
        ? `ZeroPOD currently has ${localCount} successful Redbubble publishes recorded in the last 24 hours.`
        : 'ZeroPOD could not read the current publish ledger before this deletion.';

    const detectedLine = usage?.blocked
      ? `Redbubble upload-limit status is currently DETECTED from Redbubble's own page. That detection state is stored separately from Projects and will not be erased by Clear Projects.`
      : `No Redbubble upload-limit page is currently marked as detected.`;

    const accepted = window.confirm(
      `WARNING — CLEAR ALL PROJECTS\n\n` +
      `This permanently deletes every ZeroPOD project folder, including generated artwork, metadata, project history, archived projects, and project-local published records.\n\n` +
      `${trackerLine}\n${detectedLine}\n\n` +
      `IMPORTANT: ZeroPOD's independent Redbubble publish ledger is NOT deleted by Clear Projects. The dashboard's “successful ZeroPOD publishes in the last 24h” count and total Published number are preserved. Clearing Projects also does NOT reset Redbubble's real upload limit.\n\n` +
      `Paused/stopped Automation rows linked to projects will be safely reset back to their original image + source URL so they are not left pointing at deleted project folders.\n\n` +
      `This action cannot be undone. Continue?`
    );
    if (!accepted) return;

    const finalAccepted = window.confirm(
      `FINAL CONFIRMATION\n\n` +
      `Permanently delete ALL ZeroPOD project folders now?\n\n` +
      `Publish history/counts are preserved separately. Project files themselves cannot be recovered unless you have a backup. Choose OK only if you are sure.`
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
      if (result.automationRowsReset) {
        impacts.push(`${plural(result.automationRowsReset, 'Automation row')} reset to its original input`);
      }
      impacts.push('Redbubble publish history and Published totals preserved');
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
