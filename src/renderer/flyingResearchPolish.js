(() => {
  function polish() {
    const section = document.getElementById('flyingResearch');
    if (!section || section.dataset.polished === '1') return false;
    section.dataset.polished = '1';
    section.classList.add('fr-polished');

    const heading = section.querySelector('.heading-row');
    if (heading) heading.classList.add('fr-page-heading');

    const topActions = section.querySelector(':scope > .fr-actions');
    const topHelp = topActions?.nextElementSibling?.classList?.contains('fr-small') ? topActions.nextElementSibling : null;
    if (topActions) {
      const connection = document.createElement('div');
      connection.className = 'panel fr-connection-panel';
      const title = document.createElement('div');
      title.className = 'fr-section-title';
      title.innerHTML = '<div><strong>Flying Research Session</strong><span>Login, verify, then import the results you want to use.</span></div>';
      connection.appendChild(title);
      topActions.parentNode.insertBefore(connection, topActions);
      connection.appendChild(topActions);
      if (topHelp) connection.appendChild(topHelp);
    }

    const tools = document.getElementById('frTools');
    if (tools && !tools.closest('.fr-tools-panel')) {
      const toolsPanel = document.createElement('div');
      toolsPanel.className = 'panel fr-tools-panel';
      const title = document.createElement('div');
      title.className = 'fr-section-title';
      title.innerHTML = '<div><strong>Research Tools</strong><span>Choose the Flying Research source you want to browse.</span></div>';
      tools.parentNode.insertBefore(toolsPanel, tools);
      toolsPanel.append(title, tools);
    }

    const controls = section.querySelector('.fr-controls');
    const searchPanel = controls?.closest('.panel');
    if (searchPanel) {
      searchPanel.classList.add('fr-search-panel');
      if (!searchPanel.querySelector('.fr-section-title')) {
        const title = document.createElement('div');
        title.className = 'fr-section-title';
        title.innerHTML = '<div><strong>Search & Results</strong><span>Search first, then narrow imported results only when needed.</span></div>';
        searchPanel.insertBefore(title, searchPanel.firstChild);
      }
    }

    const filters = section.querySelector('.fr-filters');
    if (filters && !filters.closest('details')) {
      const details = document.createElement('details');
      details.className = 'fr-advanced';
      const summary = document.createElement('summary');
      summary.innerHTML = '<span>Advanced filters</span><small>BSR, price, rating, reviews, dates, brand filter</small>';
      filters.parentNode.insertBefore(details, filters);
      details.append(summary, filters);
    }

    const notice = document.getElementById('frNotice');
    if (notice) notice.classList.add('fr-status-strip');

    const head = section.querySelector('.fr-head');
    if (head) head.classList.add('fr-results-head');

    section.querySelectorAll('.fr-small').forEach((node) => {
      if (/15-row limit/i.test(node.textContent || '')) {
        node.textContent = (node.textContent || '').replace(/15-row limit/i, '30-row limit');
      }
    });

    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (polish() || attempts > 30) clearInterval(timer);
  }, 250);
  polish();
})();
