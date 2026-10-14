const crypto = require('crypto');
const fresh = require('./spreadshirtFreshUploadIdentityPatch');

function stableUrlKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (/^https?:$/i.test(url.protocol)) return `${url.origin}${url.pathname}`;
  } catch {}
  return raw;
}

function sha256(value) {
  try {
    return crypto.createHash('sha256').update(value).digest('hex');
  } catch {
    return null;
  }
}

async function snapshotMarketplaceCardsWithArtworkFingerprint(page) {
  const cards = await page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const stableUrl = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      try {
        const url = new URL(raw, location.href);
        if (/^https?:$/i.test(url.protocol)) return `${url.origin}${url.pathname}`;
        return url.href;
      } catch {
        return raw;
      }
    };
    const attrId = (root) => {
      const nodes = [root, ...root.querySelectorAll('*')];
      for (const node of nodes) {
        for (const name of node.getAttributeNames?.() || []) {
          const value = String(node.getAttribute(name) || '');
          const route = value.match(/\/mp\/designs\/([^/?#"']+)/i);
          if (route?.[1]) return route[1];
          if (/design/i.test(name) && /^[a-z0-9_-]{8,}$/i.test(value)) return value;
        }
      }
      return null;
    };
    const hrefFor = (root) => {
      const links = [...root.querySelectorAll('a[href]')]
        .map((link) => ({ link, href: String(link.href || link.getAttribute('href') || '') }))
        .filter((entry) => /\/mp\/designs\//i.test(entry.href));
      const link = links[0]?.link || (root.matches?.('a[href]') ? root : null);
      if (!link?.href) return null;
      try { return new URL(link.href, location.href).href; } catch { return link.href; }
    };
    const mediaKey = (el) => {
      if (!el) return '';
      if (el.tagName === 'IMG') {
        return stableUrl(el.currentSrc || el.src || el.getAttribute('srcset') || el.getAttribute('data-src') || '');
      }
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const match = bg.match(/url\(["']?(.*?)["']?\)/i);
        return stableUrl(match?.[1] || bg);
      }
      if (el.tagName === 'CANVAS') {
        return `canvas:${el.width || 0}x${el.height || 0}`;
      }
      if (el.tagName === 'SVG') {
        return `svg:${String(el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 2000)}`;
      }
      return '';
    };
    const chooseArtwork = (root) => {
      const primary = [...root.querySelectorAll('img,picture img,canvas,[style*="background-image"]')]
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const area = rect.width * rect.height;
          const preferred = el.tagName === 'IMG' ? 3 : el.tagName === 'CANVAS' ? 2 : 1;
          return { el, rect, area, preferred, key: mediaKey(el) };
        })
        .filter((entry) => entry.rect.width >= 70 && entry.rect.height >= 70 && entry.area >= 7000)
        .sort((a, b) => (b.preferred - a.preferred) || (b.area - a.area));
      if (primary.length) return primary[0];

      const svgFallback = [...root.querySelectorAll('svg')]
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { el, rect, area: rect.width * rect.height, preferred: 0, key: mediaKey(el) };
        })
        .filter((entry) => entry.rect.width >= 100 && entry.rect.height >= 100 && entry.area >= 12000)
        .sort((a, b) => b.area - a.area);
      return svgFallback[0] || null;
    };

    const cards = [];
    const seenGeometry = new Set();
    const statuses = [...document.querySelectorAll('body *')]
      .filter((el) => visible(el) && /^(Draft|Published|In review)$/i.test(norm(el.textContent)));

    for (const statusNode of statuses) {
      let node = statusNode;
      let card = null;
      for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 140 || rect.width > 700 || rect.height < 170 || rect.height > 950) continue;

        const artwork = chooseArtwork(node);
        if (!artwork) continue;
        const imageRect = artwork.rect;
        const href = hrefFor(node);
        const designId = href?.match(/\/mp\/designs\/([^/?#]+)/i)?.[1] || attrId(node);
        const text = norm(node.innerText || node.textContent || '');
        const imageKey = artwork.key || '';
        const domIdentity = designId
          ? `id:${designId}`
          : href
            ? `href:${href}`
            : null;

        card = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          imageX: imageRect.x,
          imageY: imageRect.y,
          imageDocX: imageRect.x + window.scrollX,
          imageDocY: imageRect.y + window.scrollY,
          imageWidth: imageRect.width,
          imageHeight: imageRect.height,
          text,
          href,
          designId,
          imageKey,
          domIdentity,
          identity: domIdentity,
          status: /In review/i.test(norm(statusNode.textContent))
            ? 'In review'
            : /Published/i.test(norm(statusNode.textContent))
              ? 'Published'
              : 'Draft'
        };
        break;
      }
      if (!card) continue;
      const geometry = `${Math.round(card.x)}:${Math.round(card.y)}:${Math.round(card.width)}:${Math.round(card.height)}`;
      if (seenGeometry.has(geometry)) continue;
      seenGeometry.add(geometry);
      cards.push(card);
    }

    cards.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return cards;
  }).catch(() => []);

  // DOM IDs and hrefs are not consistently exposed on Spreadshirt's current
  // Designs grid. Fingerprint the artwork region itself so a visibly new card can
  // still be distinguished from every card that existed before the upload.
  for (const card of cards.slice(0, 30)) {
    try {
      const width = Math.max(1, Math.floor(card.imageWidth));
      const height = Math.max(1, Math.floor(card.imageHeight));
      if (width >= 70 && height >= 70) {
        const buffer = await page.screenshot({
          type: 'png',
          animations: 'disabled',
          caret: 'hide',
          clip: {
            x: Math.max(0, card.imageDocX),
            y: Math.max(0, card.imageDocY),
            width,
            height
          }
        });
        card.visualHash = sha256(buffer);
        card.visualIdentity = card.visualHash ? `visual:${card.visualHash}` : null;
      }
    } catch {
      card.visualHash = null;
      card.visualIdentity = null;
    }

    card.imageKey = stableUrlKey(card.imageKey);
    const realArtworkIdentity = card.imageKey && !/^(canvas|svg):/i.test(card.imageKey)
      ? `artwork:${card.imageKey}`
      : null;

    // The actual artwork is the source of truth. This intentionally outranks the
    // card's DOM ID/href because Spreadshirt has been exposing unreliable wrapper
    // identities while the thumbnail itself changes correctly after an upload.
    card.identity = realArtworkIdentity || card.visualIdentity || card.domIdentity || null;
  }

  return cards;
}

fresh.snapshotMarketplaceCards = snapshotMarketplaceCardsWithArtworkFingerprint;

module.exports = {
  snapshotMarketplaceCardsWithArtworkFingerprint,
  stableUrlKey
};
