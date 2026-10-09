async function retryStep(label, fn, options = {}) {
  const attempts = Math.max(1, options.attempts || 3);
  const delayMs = options.delayMs || 900;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  const message = lastError?.message || String(lastError || 'Unknown error');
  throw new Error(`${label} failed after ${attempts} attempts: ${message}`);
}

async function clickFirstVisible(candidates, options = {}) {
  const timeout = options.timeout || 8000;
  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: 'visible', timeout });
      await candidate.click();
      return true;
    } catch {}
  }
  return false;
}

async function fillFirstVisible(page, selectors, value, options = {}) {
  const timeout = options.timeout || 6000;
  for (const selector of selectors) {
    try {
      const field = page.locator(selector).first();
      await field.waitFor({ state: 'visible', timeout });
      await field.fill(value);
      return true;
    } catch {}
  }
  return false;
}

function automationError(service, step, error, recovery) {
  return {
    ok: false,
    service,
    step,
    message: error?.message || String(error),
    recovery: recovery || 'Open the service in Connections, verify you are signed in, then retry the step.'
  };
}

module.exports = { retryStep, clickFirstVisible, fillFirstVisible, automationError };
