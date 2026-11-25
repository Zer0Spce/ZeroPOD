const { SERVICES } = require('./sessionManager');
const { feature } = require('./spreadshirtAlphaIpc');

const MARKETPLACE_DESIGNS_URL = 'https://partner.spreadshirt.com/mp/designs';
const MARKETPLACE_DESIGNS_RE = /\/mp\/designs\/?(?:[?#].*)?$/i;
const MARKETPLACE_DESIGN_EDITOR_RE = /\/mp\/designs\/[^/?#]+\/?(?:[?#].*)?$/i;
const SPREADSHIRT_PARTNER_RE = /^https:\/\/partner\.spreadshirt\.com\//i;
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

async function clickDesignsNavigation(page) {
  const candidates = [
    page.locator('a[href="/mp/designs"],a[href^="/mp/designs?"],a[href$="/mp/designs"],a[href*="partner.spreadshirt.com/mp/designs"]').first(),
    page.getByRole('link', { name: /^designs$/i }).first(),
    page.locator('a,[role="link"]').filter({ hasText: /^\s*Designs\s*$/i }).first()
  ];

  for (const candidate of candidates) {
    if (!(await visible(candidate))) continue;

    const href = await candidate.getAttribute('href').catch(() => null);
    const before = page.url();
    const clicked = await candidate.click({ force: true }).then(() => true).catch(() => false);
    if (!clicked) continue;

    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (isMarketplaceDesignsIndexUrl(page.url())) return { ok: true, method: 'designs-navigation-click', href };
      await wait(150);
    }

    // If Spreadshirt's SPA swallowed the click but exposed the destination href,
    // navigate to that exact link once. This still follows the dashboard's own
    // current route instead of blindly retrying the URL that just redirected.
    if (href) {
      try {
        const target = new URL(href, before).href;
        if (isMarketplaceDesignsIndexUrl(target)) {
          await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          if (isMarketplaceDesignsIndexUrl(page.url())) return { ok: true, method: 'designs-navigation-href', href: target };
        }
      } catch {}
    }
  }

  return { ok: false };
}

async function waitForMarketplaceDesigns(page, timeoutMs = 20000) {
  const started = Date.now();
  let dashboardRecoveryAttempts = 0;
  let nextDashboardRecoveryAt = 0;

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

    // Spreadshirt can now redirect a direct /mp/designs navigation back to
    // /dashboard even while the account is fully authenticated. The Dashboard
    // exposes a working Designs navigation item, so recover through that visible
    // first-party control instead of timing out on the wrong page.
    const onPartnerPage = SPREADSHIRT_PARTNER_RE.test(url);
    const looksLikeDashboard = /\/dashboard(?:[/?#]|$)/i.test(url)
      || (/\bDashboard\b/i.test(body) && /\bDesigns\b/i.test(body) && /\bStatistics\b/i.test(body));
    if (onPartnerPage && looksLikeDashboard && Date.now() >= nextDashboardRecoveryAt && dashboardRecoveryAttempts < 4) {
      dashboardRecoveryAttempts += 1;
      nextDashboardRecoveryAt = Date.now() + 1200;
      const recovery = await clickDesignsNavigation(page);
      if (recovery.ok) {
        await wait(350);
        continue;
      }
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
    const designLinks = [...document.querySelectorAll('a[href]')]
      .filter(isVisible)
      .map((el) => ({ text: String(el.innerText || el.textContent || '').trim(), href: el.href }))
      .filter((entry) => /^Designs$/i.test(entry.text) || /\/designs(?:[/?#]|$)/i.test(entry.href))
      .slice(0, 10);
    return {
      actions,
      designLinks,
      text: String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 900)
    };
  }).catch(() => ({ actions: [], designLinks: [], text: '' }));

  throw new Error(
    `Spreadshirt Marketplace Designs page did not become ready at ${MARKETPLACE_DESIGNS_URL}. ` +
    `Current page: ${page.url()}. Dashboard recovery attempts: ${dashboardRecoveryAttempts}. ` +
    `Visible Designs links: ${diagnostics.designLinks.map((entry) => `${entry.text || 'Designs'} -> ${entry.href}`).join(' | ') || 'none'}. ` +
    `Visible actions: ${diagnostics.actions.join(' | ') || 'none'}. ` +
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
  clickDesignsNavigation,
  waitForMarketplaceDesigns
};
