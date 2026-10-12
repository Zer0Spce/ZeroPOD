(() => {
  const api = window.zeroPOD?.flyingResearch;
  if (!api) return;

  let observer = null;
  let syncQueued = false;

  function resultCount() {
    const text = String(document.getElementById('frCount')?.textContent || '');
    const number = Number(text.match(/\d+/)?.[0]);
    if (Number.isFinite(number)) return number;
    return document.querySelectorAll('#frResults .fr-card').length;
  }

  function isBusy() {
    const ids = ['frSearch', 'frCapture', 'frLoad'];
    const buttons = ids.map((id) => document.getElementById(id)).filter(Boolean);
    return buttons.length > 0 && buttons.every((button) => button.disabled);
  }

  function syncPaginationUi() {
    const section = document.getElementById('flyingResearch');
    const footer = document.getElementById('frPaginationFooter');
    const bottom = document.getElementById('frNextPageBottom');
    const hint = document.getElementById('frPaginationHint');
    const top = document.getElementById('frNextPage');
    if (!section || !footer || !bottom || !hint) return;

    const count = resultCount();
    const hasResults = count > 0;
    if (footer.hidden === hasResults) footer.hidden = !hasResults;

    if (top) {
      top.classList.remove('secondary');
      top.classList.add('primary');
      top.style.display = 'inline-flex';
      top.style.alignItems = 'center';
      top.style.justifyContent = 'center';
      top.style.minWidth = '148px';
    }

    const busy = isBusy();
    if (bottom.disabled !== busy) bottom.disabled = busy;

    const topText = String(top?.textContent || '').trim();
    const desiredText = topText && !/^No More Pages$/i.test(topText) ? topText : 'Load Next Page';
    if (bottom.textContent !== desiredText) bottom.textContent = desiredText;

    const noticeText = String(document.getElementById('frNotice')?.textContent || '').replace(/\s+/g, ' ').trim();
    const pageMatch = noticeText.match(/Page\s+\d+(?:\s+of\s+\d+)?\.?/i);
    let hintText = pageMatch?.[0] || 'Load the next Flying Research results page and append new designs.';
    if (/more results are available/i.test(noticeText)) hintText += ' More results are available.';
    else if (/last available page/i.test(noticeText)) hintText = `${pageMatch?.[0] || ''} Flying currently reports this as the last page. You can still try Next if its pagination control was missed.`.trim();
    if (hint.textContent !== hintText) hint.textContent = hintText;
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      syncPaginationUi();
    });
  }

  function mount() {
    const section = document.getElementById('flyingResearch');
    const results = document.getElementById('frResults');
    const top = document.getElementById('frNextPage');
    if (!section || !results || !top) return false;

    let footer = document.getElementById('frPaginationFooter');
    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'frPaginationFooter';
      footer.className = 'fr-pagination-footer';
      footer.hidden = true;
      footer.innerHTML = '<span id="frPaginationHint" class="fr-small">Load the next Flying Research results page and append new designs.</span><button id="frNextPageBottom" class="primary" type="button">Load Next Page</button>';
      results.insertAdjacentElement('afterend', footer);

      const style = document.createElement('style');
      style.id = 'frPaginationFooterStyle';
      style.textContent = `
        #flyingResearch .fr-pagination-footer{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin:18px 0 8px;padding:14px;border:1px solid var(--border,#394251);border-radius:12px;background:var(--surface,#171b21)}
        #flyingResearch .fr-pagination-footer[hidden]{display:none}
        #flyingResearch .fr-pagination-footer .fr-small{flex:1;min-width:220px;text-align:center}
        #flyingResearch #frNextPageBottom{min-width:180px;font-size:12px}
        html[data-theme="light"] #flyingResearch .fr-pagination-footer{background:#fff;border-color:#d3d9e3}
      `;
      document.head.appendChild(style);
    }

    const bottom = document.getElementById('frNextPageBottom');
    bottom.onclick = () => {
      if (bottom.disabled) return;
      const sourceButton = document.getElementById('frNextPage');
      if (!sourceButton) return;

      // The normal Flying Research renderer owns the append logic. Route the
      // bottom control through that proven handler, but allow a retry when the
      // site's pagination detector incorrectly disabled it.
      const wasDisabled = sourceButton.disabled;
      sourceButton.disabled = false;
      sourceButton.click();
      if (wasDisabled) queueMicrotask(queueSync);
    };

    if (!observer) {
      observer = new MutationObserver(queueSync);
      observer.observe(section, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['disabled', 'title']
      });
    }

    syncPaginationUi();
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (mount() || attempts >= 40) clearInterval(timer);
  }, 250);
  mount();
})();
