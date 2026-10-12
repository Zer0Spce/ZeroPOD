// Reads rendered Flying list cards only. No tokens, app state, or private APIs.
function readFlyingListCards() {
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const number = (value) => {
    const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const product = text(document.querySelector('#product'));
  return [...document.querySelectorAll('.list-card-content')].map((card) => {
    const metric = (name) => {
      const row = [...card.querySelectorAll('.list-card-metric')].find((el) => text(el.querySelector('.list-card-metric-label b')) === name);
      return text(row?.querySelector('.list-card-metric-value'));
    };
    const flag = card.querySelector('img[alt="Marketplace flag"]')?.getAttribute('src') || '';
    const country = flag.match(/\/([a-z]{2})\.svg(?:[?#]|$)/i)?.[1]?.toUpperCase();
    const background = card.querySelector('.list-card-design')?.style.backgroundImage || '';
    const imageUrl = background.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || null;
    const trend = card.querySelector('.list-card-bsr-status')?.getAttribute('aria-label') || null;
    const priceRow = [...card.querySelectorAll('.list-card-metric')].find((el) => text(el.querySelector('b')) === 'Price');
    const currency = priceRow?.querySelector('.fa-dollar-sign') ? 'USD' : priceRow?.querySelector('.fa-sterling-sign,.fa-pound-sign') ? 'GBP' : priceRow?.querySelector('.fa-euro-sign') ? 'EUR' : null;
    return {
      asin: text(card.querySelector('.asin-info')).match(/ASIN\s*:\s*([A-Z0-9]{10})\b/i)?.[1] || null,
      marketplace: country === 'GB' ? 'UK' : country,
      title: text(card.querySelector('.list-card-title')),
      brand: text(card.querySelector('.list-card-title-block')).replace(text(card.querySelector('.list-card-title')), '').replace(/^\s*by:\s*/i, '').trim(),
      imageUrl, productLabel: product,
      bsr: number(metric('BSR')), estimatedSales30: number(metric('Sales')),
      priceValue: number(metric('Price')), currency,
      rating: number(card.querySelector('ngb-rating')?.getAttribute('aria-valuenow')),
      reviewCount: number(text(card.querySelector('.list-card-review-count'))),
      dateFirstAvailable: text(card.querySelector('.asin-update-icon-size span')) || null,
      trendDescription: trend,
      bulletpoints: [...card.querySelectorAll('.list-card-description li')].map(text)
    };
  });
}

// Flying retains its loading node with aria-hidden=true even when it has a box.
function isFlyingResultsReady() {
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"],[hidden]')) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const loading = [...document.querySelectorAll('.research-results-loading')].some(visible);
  if (loading) return false;
  const cards = [...document.querySelectorAll('.list-card-content,.design-card-v2')].some(visible);
  const empty = [...document.querySelectorAll('strong')].some((el) => visible(el) && /^0\s+designs$/i.test(el.textContent.trim()));
  return cards || empty;
}

module.exports = { readFlyingListCards, isFlyingResultsReady };
