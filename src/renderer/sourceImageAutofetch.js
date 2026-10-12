(() => {
  let workflowBusy = false;
  let workflowBypass = false;

  function setWorkflowStatus(message, isError = false) {
    const status = document.getElementById('uwStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `uw-status ${isError ? 'validation-errors' : 'muted'}`;
  }

  function addWorkflowHint() {
    const input = document.getElementById('uwReferencePath');
    if (!input || input.dataset.sourceAutofetchHint === '1') return;
    input.dataset.sourceAutofetchHint = '1';
    input.placeholder = 'Optional — leave empty to fetch from source URL';
  }

  function mountWorkflow() {
    const button = document.getElementById('uwStart');
    const referenceInput = document.getElementById('uwReferencePath');
    const sourceInput = document.getElementById('uwSourceUrl');
    if (!button || !referenceInput || !sourceInput || !window.zeroPOD?.sourceImage?.resolve) return false;
    if (button.dataset.sourceAutofetchBound === '1') return true;

    button.dataset.sourceAutofetchBound = '1';
    addWorkflowHint();

    button.addEventListener('click', async (event) => {
      if (workflowBypass) return;
      const referencePath = referenceInput.value.trim();
      const sourceUrl = sourceInput.value.trim();
      if (referencePath || !sourceUrl) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (workflowBusy) return;
      workflowBusy = true;
      const originalDisabled = button.disabled;
      button.disabled = true;

      try {
        setWorkflowStatus('Fetching reference image from Amazon / source URL…');
        const result = await window.zeroPOD.sourceImage.resolve(sourceUrl);
        if (!result?.path) throw new Error('ZeroPOD did not receive a usable reference image path.');
        referenceInput.value = result.path;
        setWorkflowStatus(`Reference image fetched${result.cached ? ' from cache' : ''}. Starting workflow…`);
        workflowBypass = true;
        button.disabled = originalDisabled;
        button.click();
      } catch (error) {
        setWorkflowStatus(`Could not fetch reference image: ${error.message || error}`, true);
      } finally {
        workflowBypass = false;
        workflowBusy = false;
        button.disabled = originalDisabled;
      }
    }, true);

    return true;
  }

  function start() {
    if (mountWorkflow()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (mountWorkflow() || attempts >= 40) clearInterval(timer);
    }, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
