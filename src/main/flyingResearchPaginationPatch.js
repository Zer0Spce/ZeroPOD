const { FlyingResearchFeature } = require('./flyingResearchFeature');
const { readFlyingListCards } = require('./flyingResearchDom');

const paginationState = new WeakMap();

function paginationRootAndActive() {
  const visible = (element) => {
    if (!element || element.closest?.('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  };
  const selector = [
    'ngb-pagination',
    '.pagination',
    '[class*="pagination"]',
    'mat-paginator',
    '.mat-mdc-paginator',
    '.mat-paginator',
    '[class*="paginator"]',
    '[class*="pager"]',
    'nav[aria-label*="page" i]',
    '[role="navigation"][aria-label*="page" i]'
  ].join(',');
  const roots = [...document.querySelectorAll(selector)].filter(visible);
  const root = roots.find((candidate) => [...candidate.querySelectorAll('.active,[aria-current="page"]')].some(visible))
    || roots.find((candidate) => candidate.querySelector('a,button'))
    || document;
  const active = [...root.querySelectorAll('.active,[aria-current="page"]')].find(visible) || null;
  const activeItem = active?.closest?.('li,.page-item,[role="listitem"]') || active;
  return { visible, root, active, activeItem };
}

function isDisabledPaginationControl(element) {
  if (!element) return true;
  const parent = element.closest?.('.disabled,[aria-disabled="true"]');
  return Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true' || parent);
}

function paginationControlText(element) {
  if (!element) return '';
  const className = typeof element.className === 'string' ? element.className : element.className?.baseVal || '';
  return [
    element.getAttribute?.('aria-label') || '',
    element.getAttribute?.('title') || '',
    element.getAttribute?.('data-testid') || '',
    element.getAttribute?.('data-test') || '',
    className,
    element.textContent || ''
  ].join(' ').replace(/\s+/g, ' ').trim();
}

function findNextPaginationControl(root, activeItem, visible) {
  const explicitSelectors = [
    'a[rel="next"]',
    'button[rel="next"]',
    '[aria-label*="next" i]',
    '[title*="next" i]',
    '[data-testid*="next" i]',
    '[data-test*="next" i]',
    'button[class*="next" i]',
    'a[class*="next" i]',
    '.mat-mdc-paginator-navigation-next',
    '.mat-paginator-navigation-next'
  ].join(',');
  const explicit = [...root.querySelectorAll(explicitSelectors)]
    .find((el) => visible(el) && !isDisabledPaginationControl(el));
  if (explicit) return explicit;

  const sibling = activeItem?.nextElementSibling || null;
  if (sibling) {
    const candidate = sibling.matches?.('a,button') ? sibling : sibling.querySelector?.('a,button');
    if (visible(candidate) && !isDisabledPaginationControl(candidate)) return candidate;
  }

  const currentText = String(activeItem?.textContent || '').trim();
  const currentPage = Number(currentText.match(/\d+/)?.[0]) || null;
  if (currentPage) {
    const numericNext = [...root.querySelectorAll('a,button')].find((el) => {
      if (!visible(el) || isDisabledPaginationControl(el)) return false;
      return Number(String(el.textContent || '').trim()) === currentPage + 1;
    });
    if (numericNext) return numericNext;
  }

  const byText = [...root.querySelectorAll('a,button')].find((el) => {
    if (!visible(el) || isDisabledPaginationControl(el)) return false;
    const text = paginationControlText(el);
    return /(?:^|\s)(?:next|next page|load more|show more|chevron[-_ ]?right|arrow[-_ ]?forward|keyboard[-_ ]?arrow[-_ ]?right|navigate[-_ ]?next)(?:\s|$)|^(?:›|»|→|>)$/i.test(text);
  });
  if (byText) return byText;

  return null;
}

function readPaginationState() {
  const { visible, root, active, activeItem } = paginationRootAndActive();
  const activeText = String(active?.textContent || activeItem?.textContent || '').trim();
  const currentPage = Number(activeText.match(/\d+/)?.[0]) || null;
  const numeric = [...root.querySelectorAll('a,button')]
    .filter(visible)
    .map((el) => Number(String(el.textContent || '').trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const totalPages = numeric.length ? Math.max(...numeric) : null;
  const next = findNextPaginationControl(root, activeItem, visible);
  return {
    currentPage,
    totalPages,
    hasNext: Boolean(next),
    nextLabel: next ? paginationControlText(next) : null
  };
}

function clickNextPageControl() {
  const { visible, root, activeItem } = paginationRootAndActive();
  const next = findNextPaginationControl(root, activeItem, visible);
  if (!next) return { clicked: false };
  next.scrollIntoView({ block: 'center', inline: 'center' });
  next.click();
  return { clicked: true, label: paginationControlText(next) };
}

function pageChangedSince(before) {
  const visible = (element) => {
    if (!element || element.closest?.('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const loading = [...document.querySelectorAll('.research-results-loading')].some(visible);
  if (loading) return false;
  const cards = [...document.querySelectorAll('.list-card-content,.design-card-v2')].filter(visible);
  const signature = cards.map((card) => {
    const text = String(card.textContent || '').replace(/\s+/g, ' ');
    return text.match(/ASIN\s*:\s*([A-Z0-9]{10})\b/i)?.[1] || text.slice(0, 120);
  }).join('|');
  const selector = [
    'ngb-pagination',
    '.pagination',
    '[class*="pagination"]',
    'mat-paginator',
    '.mat-mdc-paginator',
    '.mat-paginator',
    '[class*="paginator"]',
    '[class*="pager"]',
    'nav[aria-label*="page" i]',
    '[role="navigation"][aria-label*="page" i]'
  ].join(',');
  const roots = [...document.querySelectorAll(selector)].filter(visible);
  const root = roots.find((candidate) => [...candidate.querySelectorAll('.active,[aria-current="page"]')].some(visible)) || roots[0] || document;
  const active = [...root.querySelectorAll('.active,[aria-current="page"]')].find(visible) || null;
  const currentPage = Number(String(active?.textContent || '').match(/\d+/)?.[0]) || null;
  return (before.currentPage && currentPage && currentPage !== before.currentPage) || (signature && signature !== before.signature);
}

function keyFor(item) {
  return String(item?.key || item?.id || `${item?.marketplace || ''}:${item?.asin || ''}`);
}

function makeState(result, pageInfo, marketplaceHint = null) {
  const items = new Map();
  for (const item of result?.items || []) items.set(keyFor(item), item);
  return {
    items,
    page: pageInfo?.currentPage || 1,
    totalPages: pageInfo?.totalPages || null,
    hasNext: Boolean(pageInfo?.hasNext),
    marketplaceHint: marketplaceHint || null,
    sourceUrl: result?.sourceUrl || null
  };
}

function resultWithPagination(result, state, added = null) {
  const items = [...state.items.values()];
  return {
    ...result,
    items,
    count: items.length,
    added: added === null ? items.length : added,
    page: state.page,
    totalPages: state.totalPages,
    hasNext: state.hasNext
  };
}

const originalSearch = FlyingResearchFeature.prototype.search;
FlyingResearchFeature.prototype.search = async function searchWithPagination(payload = {}) {
  const result = await originalSearch.call(this, payload);
  const page = await this.ensurePage();
  const pageInfo = await page.evaluate(readPaginationState).catch(() => ({ currentPage: 1, totalPages: null, hasNext: false }));
  const hint = payload.marketplace && payload.marketplace !== 'ALL' ? payload.marketplace : null;
  const state = makeState(result, pageInfo, hint);
  paginationState.set(this, state);
  return resultWithPagination(result, state);
};

const originalCapture = FlyingResearchFeature.prototype.capture;
FlyingResearchFeature.prototype.capture = async function captureWithPagination(payload = {}) {
  const result = await originalCapture.call(this, payload);
  const page = await this.ensurePage();
  const pageInfo = await page.evaluate(readPaginationState).catch(() => ({ currentPage: 1, totalPages: null, hasNext: false }));
  const state = makeState(result, pageInfo, payload.marketplaceHint || null);
  paginationState.set(this, state);
  return resultWithPagination(result, state);
};

FlyingResearchFeature.prototype.loadNextPage = async function loadNextPage() {
  const page = await this.ensurePage();
  await this.requireSignedIn(page);
  await this.waitForResults(page);

  let state = paginationState.get(this);
  if (!state) {
    const seed = await originalCapture.call(this, {});
    const pageInfo = await page.evaluate(readPaginationState).catch(() => ({ currentPage: 1, totalPages: null, hasNext: false }));
    state = makeState(seed, pageInfo, null);
    paginationState.set(this, state);
  }

  // Flying can render its paginator below a long result grid. Move to the
  // bottom before resolving the live Next control so lazy/Angular controls
  // are present and measurable.
  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement || document.body;
    window.scrollTo(0, root?.scrollHeight || document.body?.scrollHeight || 0);
  }).catch(() => {});
  await page.waitForTimeout(300);

  const pageInfo = await page.evaluate(readPaginationState);
  const beforeCards = await page.evaluate(readFlyingListCards).catch(() => []);
  const before = {
    currentPage: pageInfo.currentPage,
    signature: beforeCards.map((card) => card.asin || String(card.title || '').slice(0, 120)).join('|')
  };

  // Do not stop solely because the first state probe missed the Next button.
  // The click probe uses the same selectors plus numeric-page and class-based
  // fallbacks, which is more reliable on Flying's changing Angular markup.
  const clicked = await page.evaluate(clickNextPageControl);
  if (!clicked?.clicked) {
    const pageLabel = pageInfo.currentPage ? ` after page ${pageInfo.currentPage}` : '';
    throw new Error(`Flying Research does not show another usable results page${pageLabel}. Open Flying Tools to confirm the site's pagination controls.`);
  }

  await page.waitForFunction(pageChangedSince, before, { timeout: 45000 }).catch(async (error) => {
    if (error?.name !== 'TimeoutError') throw error;
    await this.requireSignedIn(page);
    throw new Error('Flying Research did not finish loading the next page within 45 seconds.');
  });
  await this.waitForResults(page);

  const pageResult = await originalCapture.call(this, { marketplaceHint: state.marketplaceHint });
  const previousCount = state.items.size;
  for (const item of pageResult.items || []) state.items.set(keyFor(item), item);
  const afterInfo = await page.evaluate(readPaginationState).catch(() => ({ currentPage: (state.page || 1) + 1, totalPages: state.totalPages, hasNext: false }));
  state.page = afterInfo.currentPage || (state.page || 1) + 1;
  state.totalPages = afterInfo.totalPages || state.totalPages || null;
  state.hasNext = Boolean(afterInfo.hasNext);
  state.sourceUrl = pageResult.sourceUrl || state.sourceUrl;
  paginationState.set(this, state);

  return resultWithPagination(pageResult, state, state.items.size - previousCount);
};

module.exports = { readPaginationState, clickNextPageControl, pageChangedSince };
