(() => {
  function setLiveView(id) {
    document.querySelectorAll('.nav').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === id);
    });
    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('active-view', view.id === id);
    });
  }

  // app.js captures .nav/.view NodeLists before Research is inserted dynamically.
  // Reconcile navigation with the live DOM after every nav click so Research never
  // remains visible underneath Workflow, Projects, Settings, etc.
  document.addEventListener('click', (event) => {
    const nav = event.target.closest?.('.nav[data-view]');
    if (!nav) return;
    queueMicrotask(() => setLiveView(nav.dataset.view));
  });

  function isMerchCard(card) {
    return Boolean(card?.dataset?.key && card.closest('#research'));
  }

  function decorateCards() {
    document.querySelectorAll('#research .rs-card').forEach((card) => {
      if (!isMerchCard(card)) return;
      const actions = card.querySelector('.rs-actions');
      if (!actions || actions.querySelector('[data-action="workflow"]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'workflow';
      button.dataset.key = card.dataset.key;
      button.className = 'primary';
      button.textContent = 'Send to Workflow';
      actions.appendChild(button);
    });
  }

  function updateResearchCopy() {
    const research = document.getElementById('research');
    if (!research) return;
    const headingText = research.querySelector('.heading-row .muted');
    if (headingText && /Amazon Best Sellers provenance/i.test(headingText.textContent || '')) {
      headingText.textContent = 'Amazon Merch design discovery + real product-page BSR when available. Merch browse position is never treated as Best Seller rank.';
    }

    const firstTab = research.querySelector('.rs-tab[data-tab="best"]');
    if (firstTab && firstTab.textContent.trim() === 'Best Sellers') firstTab.textContent = 'Merch Designs';

    const sourceLabel = research.querySelector('label.wide');
    if (sourceLabel && /Best Sellers source URL/i.test(sourceLabel.textContent || '')) {
      const input = sourceLabel.querySelector('input');
      sourceLabel.childNodes[0].textContent = 'Amazon source URL ';
      const mini = sourceLabel.querySelector('.rs-mini');
      if (mini) mini.textContent = '(optional; built-in US source uses the Amazon Merch designs node)';
      if (input) input.placeholder = 'Leave blank for built-in Amazon Merch designs, or paste a genuine Amazon Best Sellers category URL';
    }

    const rankOption = research.querySelector('#rsSort option[value="rank"]');
    if (rankOption) rankOption.textContent = 'Best Seller Position (when verified)';
  }

  function reconcileRefreshMessage() {
    const notice = document.querySelector('#rsNotice .rs-notice.ok');
    const context = document.getElementById('rsContext');
    if (!notice || !context) return;
    if (!/verified directly from the Amazon Best Sellers page/i.test(notice.textContent || '')) return;

    const visible = [...document.querySelectorAll('#research .rs-card')];
    const ranked = visible.filter((card) => {
      const text = card.textContent || '';
      return /BSR\s+#\s*[\d,]+/i.test(text);
    }).length;
    const total = visible.length;
    notice.textContent = `${total} Amazon Merch design${total === 1 ? '' : 's'} found · ${ranked} with BSR.`;
    context.textContent = `${total} Amazon Merch designs · ${ranked} with product-page BSR`;
  }

  async function sendToWorkflow(key, button) {
    if (!key || !window.zeroPOD?.research?.get) return;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Loading…';
    try {
      const item = await window.zeroPOD.research.get(key);
      if (!item) throw new Error('This research item is no longer eligible. Refresh Research and try again.');
      if (!item.cachedImagePath) throw new Error('The research image is not cached yet. Refresh this feed first.');

      const reference = document.getElementById('uwReferencePath');
      const source = document.getElementById('uwSourceUrl');
      const status = document.getElementById('uwStatus');
      if (!reference || !source) throw new Error('Workflow controls are unavailable. Restart ZeroPOD and try again.');

      reference.value = item.cachedImagePath;
      source.value = item.canonicalUrl || '';
      const workflowNav = document.querySelector('.nav[data-view="create"]');
      if (workflowNav) workflowNav.click();
      else setLiveView('create');
      setLiveView('create');

      if (status) status.textContent = `Research design loaded: ${item.title || item.asin}. Review Workflow options, then press Start Workflow.`;
      document.getElementById('uwStart')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      alert(error?.message || String(error));
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('#research [data-action="workflow"]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    sendToWorkflow(button.dataset.key, button);
  });

  const observer = new MutationObserver(() => {
    updateResearchCopy();
    decorateCards();
    reconcileRefreshMessage();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  updateResearchCopy();
  decorateCards();
})();
