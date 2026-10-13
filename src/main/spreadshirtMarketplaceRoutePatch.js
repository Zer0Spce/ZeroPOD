const { SERVICES } = require('./sessionManager');
const { feature } = require('./spreadshirtAlphaIpc');

const MARKETPLACE_DESIGNS_URL = 'https://partner.spreadshirt.com/mp/designs';
const MARKETPLACE_DESIGNS_RE = /\/mp\/designs\/?(?:[?#].*)?$/i;
const MARKETPLACE_DESIGN_EDITOR_RE = /\/mp\/designs\/[^/?#]+\/?(?:[?#].*)?$/i;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isMarketplaceDesignsIndexUrl(value) {
  return MARKETPLACE_DESIGNS_RE.test(String(value || ''));
}

function isMarketplaceDesignEditorUrl(value) {
  return MARKETPLACE_DESIGN_EDITOR_RE.test(String(value || ''));
}

async function visible(locator) {
  try {
    return Boolean(await locator.count()) && await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function waitForMarketplaceDesigns(page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const url = page.url();
    const body = await page.locator('body').innerText().catch(() => '');
    const createNewCandidates = [
      page.getByRole('button', { name: /create new/i }).first(),
      page.getByRole('link', { name: /create new/i }).first(),
      page.getByText(/create new/i, { exact: true }).first(),
      page.locator('button,a,[role="button"]').filter({ hasText: /create\s+new/i }).first(),
      page.locator('[aria-label*="create new" i],[title*="create new" i],[data-testid*="create" i]').first()
    ];
    for (const candidate of createNewCandidates) {
      if (await visible(candidate)) return true;
    }
    if (/sign in|log in|register/i.test(body) && !/designs|showroom|statistics|account/i.test(body)) {
      throw new Error('Spreadshirt login is required. Use Open Login Browser, sign in, then Test Session.');
    }
    if (!isMarketplaceDesignsIndexUrl(url) && /\/designs(?:[/?#]|$)/i.test(url) && !isMarketplaceDesignEditorUrl(url)) {
      await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    await wait(350);
  }

  const diagnostics = await page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const actions = [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(isVisible)
      .map((el) => String(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim())
      .filter(Boolean)
      .slice(0, 40);
    return { actions, text: String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 900) };
  }).catch(() => ({ actions: [], text: '' }));

  throw new Error(
    `Spreadshirt Marketplace Designs page did not become ready at ${MARKETPLACE_DESIGNS_URL}. ` +
    `Current page: ${page.url()}. Visible actions: ${diagnostics.actions.join(' | ') || 'none'}. ` +
    `Page text: ${diagnostics.text || 'unavailable'}`
  );
}

if (SERVICES.spreadshirt) {
  SERVICES.spreadshirt.url = MARKETPLACE_DESIGNS_URL;
  SERVICES.spreadshirt.authenticatedSelectors = [
    'a[href*="/mp/designs" i]',
    'a[href*="/mp/showroom" i]',
    'a[href*="/mp/statistics" i]',
    'a[href*="/designs" i]',
    '[data-testid*="account" i]',
    'nav a[href*="/account" i]'
  ];
}

feature.openDesigns = async function openMarketplaceDesigns(page) {
  if (!isMarketplaceDesignsIndexUrl(page.url())) {
    await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } else {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  await this.ensureSignedIn(page);
  await waitForMarketplaceDesigns(page, 20000);
  return true;
};

feature.open = async function openMarketplaceDesignsInBrowser() {
  const { page } = await this.sessions.ensureService('spreadshirt');
  if (!isMarketplaceDesignsIndexUrl(page.url())) {
    await page.goto(MARKETPLACE_DESIGNS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await page.bringToFront();
  await this.ensureSignedIn(page);
  await waitForMarketplaceDesigns(page, 20000);
  return { ok: true, url: page.url() };
};

module.exports = {
  MARKETPLACE_DESIGNS_URL,
  MARKETPLACE_DESIGNS_RE,
  MARKETPLACE_DESIGN_EDITOR_RE,
  isMarketplaceDesignsIndexUrl,
  isMarketplaceDesignEditorUrl,
  waitForMarketplaceDesigns
};
