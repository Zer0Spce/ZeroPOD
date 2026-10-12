const { FlyingResearchFeature } = require('./flyingResearchFeature');
const { readFlyingListCards } = require('./flyingResearchDom');

const paginationState = new WeakMap();

function readPaginationState() {
  const visible = (element) => {
    if (!element || element.closest?.('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  };
  const disabled = (element) => {
    if (!element) return true;
    const parent = element.closest?.('.disabled,[aria-disabled="true"]');
    return Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true' || parent);
  };
  const roots = [...document.querySelectorAll('ngb-pagination,.pagination,[class*="pagination"],nav[aria-label*="pagination" i]')].filter(visible);
  const root = roots[0] || document;
  const active = [...root.querySelectorAll('.active,[aria-current="page"]')].find(visible) || null;
  const activeText = String(active?.textContent || '').trim();
  const currentPage = Number(activeText.match(/\d+/)?.[0]) || null;
  const numeric = [...root.querySelectorAll('a,button')]
    .filter(visible)
    .map((el) => Number(String(el.textContent || '').trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const totalPages = numeric.length ? Math.max(...numeric) : null;
  const explicit = [
    ...root.querySelectorAll('a[rel="next"],button[rel="next"],[aria-label*="next" i],[title*="next" i]')
  ].find((el) => visible(el) && !disabled(el));
  let next = explicit || null;
  if (!next && active?.parentElement?.nextElementSibling) {
    const candidate = active.parentElement.nextElementSibling.querySelector?.('a,button') || active.parentElement.nextElementSibling;
    if (visible(candidate) && !disabled(candidate)) next = candidate;
  }
  if (!next) {
    next = [...root.querySelectorAll('a,button')].find((el) => {
      if (!visible(el) || disabled(el)) return false;
      const text = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim();
      return /^(?:next|next page|›|»|→)$/i.test(text);
    }) || null;
  }
  return {
    currentPage,
    totalPages,
    hasNext: Boolean(next),
    nextLabel: next ? String(next.getAttribute('aria-label') || next.getAttribute('title') || next.textContent || '').replace(/\s+/g, ' ').trim() : null
  };
}

function clickNextPageControl() {
  const visible = (element) => {
    if (!element || element.closest?.('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  };
  const disabled = (element) => {
    if (!element) return true;
    const parent = element.closest?.('.disabled,[aria-disabled="true"]');
    return Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true' || parent);
  };
  const roots = [...document.querySelectorAll('ngb-pagination,.pagination,[class*="pagination"],nav[aria-label*="pagination" i]')].filter(visible);
  const root = roots[0] || document;
  const active = [...root.querySelectorAll('.active,[aria-current="page"]')].find(visible) || null;
  let next = [...root.querySelectorAll('a[rel="next"],button[rel="next"],[aria-label*="next" i],[title*="next" i]')]
    .find((el) => visible(el) && !disabled(el)) || null;
  if (!next && active?.parentElement?.nextElementSibling) {
    const candidate = active.parentElement.nextElementSibling.querySelector?.('a,button') || active.parentElement.nextElementSibling;
    if (visible(candidate) && !disabled(candidate)) next = candidate;
  }
  if (!next) {
    next = [...root.querySelectorAll('a,button')].find((el) => {
      if (!visible(el) || disabled(el)) return false;
      const text = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim();
      return /^(?:next|next page|›|»|→)$/i.test(text);
    }) || null;
  }
  if (!next) return { clicked: false };
  next.scrollIntoView({ block: 'center', inline: 'center' });
  next.click();
  return { clicked: true };
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
  const roots = [...document.querySelectorAll('ngb-pagination,.pagination,[class*="pagination"],nav[aria-label*="pagination" i]')].filter(visible);
  const root = roots[0] || document;
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

  const pageInfo = await page.evaluate(readPaginationState);
  if (!pageInfo.hasNext) {
    const pageLabel = pageInfo.currentPage ? ` after page ${pageInfo.currentPage}` : '';
    throw new Error(`Flying Research does not show another results page${pageLabel}.`);
  }

  const beforeCards = await page.evaluate(readFlyingListCards).catch(() => []);
  const before = {
    currentPage: pageInfo.currentPage,
    signature: beforeCards.map((card) => card.asin || String(card.title || '').slice(0, 120)).join('|')
  };

  const clicked = await page.evaluate(clickNextPageControl);
  if (!clicked?.clicked) throw new Error('Flying Research shows more results, but ZeroPOD could not activate the Next page control. Open Flying Tools and use Next manually, then Import Current Results.');

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
