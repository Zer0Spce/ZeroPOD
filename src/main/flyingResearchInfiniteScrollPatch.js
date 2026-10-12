const { FlyingResearchFeature } = require('./flyingResearchFeature');
const { readFlyingListCards } = require('./flyingResearchDom');

const loadState = new WeakMap();

function itemKey(item) {
  return String(item?.key || item?.id || `${item?.marketplace || ''}:${item?.asin || ''}`);
}

function cardKey(card) {
  return String(card?.asin || card?.title || '').trim();
}

function mergeResult(feature, result, { reset = false, exhausted = false, page = null } = {}) {
  let state = loadState.get(feature);
  if (!state || reset) {
    state = { items: new Map(), exhausted: false, page: 1 };
    loadState.set(feature, state);
  }

  const previousCount = state.items.size;
  for (const item of result?.items || []) state.items.set(itemKey(item), item);
  state.exhausted = Boolean(exhausted);
  if (page !== null) state.page = page;
  else if (Number(result?.page) > 0) state.page = Number(result.page);

  const items = [...state.items.values()];
  return {
    ...result,
    items,
    count: items.length,
    added: Math.max(0, items.length - previousCount),
    page: state.page || 1,
    totalPages: result?.totalPages || null,
    // Flying frequently lazy-loads on scroll without a paginator. Keep the
    // loader available until an actual scroll probe fails to reveal new cards.
    hasNext: items.length > 0 && !state.exhausted
  };
}

function scrollFlyingResultsOnce() {
  const visible = (element) => {
    if (!element || element.closest?.('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const cards = [...document.querySelectorAll('.list-card-content,.design-card-v2')].filter(visible);
  const last = cards[cards.length - 1] || null;

  const isScrollable = (element) => {
    if (!element || !visible(element)) return false;
    const style = getComputedStyle(element);
    const overflow = `${style.overflowY || ''} ${style.overflow || ''}`;
    return /(auto|scroll|overlay)/i.test(overflow) && element.scrollHeight > element.clientHeight + 40;
  };

  let target = last?.parentElement || null;
  while (target && target !== document.body && !isScrollable(target)) target = target.parentElement;

  if (!isScrollable(target)) {
    const candidates = [...document.querySelectorAll('div,main,section,article')].filter(isScrollable);
    candidates.sort((a, b) => {
      const aCards = a.querySelectorAll?.('.list-card-content,.design-card-v2').length || 0;
      const bCards = b.querySelectorAll?.('.list-card-content,.design-card-v2').length || 0;
      if (aCards !== bCards) return bCards - aCards;
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
    });
    target = candidates[0] || null;
  }

  last?.scrollIntoView?.({ block: 'end', inline: 'nearest' });

  let targetMoved = false;
  if (target && isScrollable(target)) {
    const before = target.scrollTop;
    target.scrollTop = target.scrollHeight;
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
    try {
      target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: Math.max(target.clientHeight * 0.9, 700) }));
    } catch {}
    targetMoved = target.scrollTop !== before;
  }

  const root = document.scrollingElement || document.documentElement || document.body;
  const beforeWindow = root?.scrollTop || window.scrollY || 0;
  window.scrollTo(0, root?.scrollHeight || document.body?.scrollHeight || 0);
  window.dispatchEvent(new Event('scroll'));

  return {
    cardCount: cards.length,
    targetMoved,
    windowMoved: (root?.scrollTop || window.scrollY || 0) !== beforeWindow,
    targetClass: target?.className || null
  };
}

async function waitForDifferentCards(page, beforeKeys, attempts = 8) {
  const before = new Set(beforeKeys || []);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.evaluate(scrollFlyingResultsOnce).catch(() => null);
    await page.waitForTimeout(attempt < 2 ? 700 : 1100);
    const batch = await page.evaluate(readFlyingListCards).catch(() => []);
    const keys = batch.map(cardKey).filter(Boolean);
    if (keys.some((key) => !before.has(key))) return { changed: true, batch };

    const loading = page.locator('.research-results-loading:visible');
    if (await loading.count()) {
      await loading.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      const afterLoading = await page.evaluate(readFlyingListCards).catch(() => []);
      const afterKeys = afterLoading.map(cardKey).filter(Boolean);
      if (afterKeys.some((key) => !before.has(key))) return { changed: true, batch: afterLoading };
    }
  }
  return { changed: false, batch: await page.evaluate(readFlyingListCards).catch(() => []) };
}

// Fix Flying's lazy/infinite result loading. The site often scrolls an inner
// results container, not the browser window, so the older collector could stop
// around the first rendered batch even while the website had more designs.
FlyingResearchFeature.prototype.collectLoadedCards = async function collectLoadedCardsWithInnerScroll(page) {
  const collected = new Map();
  let stagnant = 0;
  let previousSize = 0;

  for (let pass = 0; pass < 30 && collected.size < 200; pass += 1) {
    const batch = await page.evaluate(readFlyingListCards).catch(() => []);
    for (const card of batch) {
      const identity = cardKey(card);
      if (identity) collected.set(identity, card);
    }

    if (collected.size === previousSize) stagnant += 1;
    else stagnant = 0;
    previousSize = collected.size;
    if (stagnant >= 4) break;

    await page.evaluate(scrollFlyingResultsOnce).catch(() => null);
    await page.waitForTimeout(650);
    const loading = page.locator('.research-results-loading:visible');
    if (await loading.count()) await loading.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  return [...collected.values()];
};

const previousSearch = FlyingResearchFeature.prototype.search;
FlyingResearchFeature.prototype.search = async function searchWithLazyLoadState(payload = {}) {
  const result = await previousSearch.call(this, payload);
  return mergeResult(this, result, { reset: true, exhausted: result?.count === 0, page: 1 });
};

const previousCapture = FlyingResearchFeature.prototype.capture;
FlyingResearchFeature.prototype.capture = async function captureWithLazyLoadState(payload = {}) {
  const result = await previousCapture.call(this, payload);
  return mergeResult(this, result, { reset: true, exhausted: result?.count === 0, page: Number(result?.page) || 1 });
};

const previousPagedLoadNext = FlyingResearchFeature.prototype.loadNextPage;
FlyingResearchFeature.prototype.loadNextPage = async function loadNextPageOrScroll() {
  let state = loadState.get(this);
  if (!state) {
    const seed = await previousCapture.call(this, {});
    mergeResult(this, seed, { reset: true, exhausted: seed?.count === 0, page: Number(seed?.page) || 1 });
    state = loadState.get(this);
  }

  // Prefer a real paginator when Flying exposes one. If it does not, fall back
  // to scrolling the live results container and watching for newly rendered cards.
  try {
    const paged = await previousPagedLoadNext.call(this);
    const merged = mergeResult(this, paged, { exhausted: false, page: Number(paged?.page) || (state.page + 1) });
    if (merged.added > 0) return merged;
  } catch (error) {
    if (!/does not show another usable results page|could not activate the Next page control|does not show another results page/i.test(String(error?.message || error))) throw error;
  }

  const page = await this.ensurePage();
  await this.requireSignedIn(page);
  await this.waitForResults(page);

  const beforeCards = await page.evaluate(readFlyingListCards).catch(() => []);
  const beforeKeys = beforeCards.map(cardKey).filter(Boolean);
  const probe = await waitForDifferentCards(page, beforeKeys);

  if (!probe.changed) {
    state.exhausted = true;
    const items = [...state.items.values()];
    return {
      items,
      count: items.length,
      added: 0,
      page: state.page || 1,
      totalPages: null,
      hasNext: false,
      capturedAt: new Date().toISOString(),
      sourceUrl: page.url(),
      skippedItems: []
    };
  }

  const captured = await previousCapture.call(this, {});
  const nextPage = (state.page || 1) + 1;
  const merged = mergeResult(this, captured, { exhausted: false, page: nextPage });
  return { ...merged, page: nextPage, hasNext: true };
};

module.exports = { scrollFlyingResultsOnce, waitForDifferentCards };
