'use strict';

// Keep Amazon's existing three-attempt importer intact. Other sources can be
// queued with a user-chosen local reference image, without scraping sites that
// prohibit or restrict automated access to their listings.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AutomateListFeature } = require('./automateListFeature');
const { extractAsin } = require('./researchProvider');

function sourceForUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.local')) return null;
    if (/^(?:127|10|192\.168|169\.254)\./.test(host) || host === '0.0.0.0' || host === '[::1]') return null;
    if (/^(?:amazon\.(?:com|de|fr|it|es)|amazon\.co\.uk)$/.test(host)) return 'Amazon';
    if (host === 'etsy.com' || host.endsWith('.etsy.com')) return 'Etsy';
    if (host === 'redbubble.com' || host.endsWith('.redbubble.com')) return 'Redbubble';
    if (host === 'teepublic.com' || host.endsWith('.teepublic.com')) return 'TeePublic';
    if (host === 'zazzle.com' || host.endsWith('.zazzle.com')) return 'Zazzle';
    if (host === 'threadless.com' || host.endsWith('.threadless.com')) return 'Threadless';
    if (host === 'spreadshirt.com' || host.endsWith('.spreadshirt.com')) return 'Spreadshirt';
    if (host === 'society6.com' || host.endsWith('.society6.com')) return 'Society6';
    return 'Other';
  } catch {
    return null;
  }
}

function productTitle(url, source) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = decodeURIComponent(parts[parts.length - 1] || '');
    const title = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return title && !/^\d+$/.test(title) ? title.slice(0, 120) : source + ' listing';
  } catch {
    return source + ' listing';
  }
}

async function validateReferenceImage(file) {
  const pathname = String(file || '');
  const extension = path.extname(pathname).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    throw new Error('Choose a PNG, JPG, or WEBP reference image.');
  }
  const stats = await fs.promises.stat(pathname);
  if (!stats.isFile() || stats.size < 1000 || stats.size > 40 * 1024 * 1024) {
    throw new Error('The reference image must be a valid file between 1 KB and 40 MB.');
  }
  const metadata = await sharp(pathname, { limitInputPixels: 40000000 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height) {
    throw new Error('The selected file is not a supported image.');
  }
}

const originalProcessItem = AutomateListFeature.prototype.processItem;
AutomateListFeature.prototype.processItem = async function processMultiMarketplaceItem(item) {
  const source = sourceForUrl(item.url);
  if (!source) {
    this.store.updateItem(item.id, {
      status: 'skipped',
      retryable: false,
      reason: 'Invalid source URL. Use a public HTTPS product link.'
    });
    return;
  }
  if (source === 'Amazon' && !item.localReferenceImage) {
    return originalProcessItem.call(this, item);
  }
  const duplicate = this.existingAutomationDuplicate(item.url, source === 'Amazon' ? extractAsin(item.url) : null);
  if (duplicate) {
    this.store.updateItem(item.id, {
      status: 'skipped',
      retryable: false,
      reason: 'Already exists in Automation.',
      automationRowId: duplicate.id || null,
      sourcePlatform: source
    });
    return;
  }

  if (!item.localReferenceImage) {
    this.store.updateItem(item.id, {
      sourcePlatform: source,
      title: item.title || productTitle(item.url, source),
      status: 'needs-image',
      reason: 'Attach a reference image you own or are authorized to use. Automatic scraping is not enabled for ' + source + '.'
    });
    return;
  }

  try {
    await validateReferenceImage(item.localReferenceImage);
  } catch (error) {
    this.store.updateItem(item.id, {
      sourcePlatform: source,
      status: 'needs-image',
      reason: 'Reference image needs replacement: ' + (error.message || String(error))
    });
    return;
  }

  if (!this.automationHasSpace()) {
    this.store.updateItem(item.id, {
      sourcePlatform: source,
      status: 'waiting-space',
      reason: 'Automation has 30 rows. Waiting for an available slot.'
    });
    return;
  }

  const rowId = Date.now() + '-' + require('crypto').randomBytes(3).toString('hex');
  const referenceImage = this.copyIntoAutomationStorage(item.localReferenceImage, rowId);
  this.automationStore.addRows([{
    id: rowId,
    enabled: true,
    referenceImage,
    amazonLink: item.url, // Existing Automation storage field accepts any source URL.
    notes: 'Use this image only as inspiration. Create an original POD design, not a copy.',
    status: 'pending',
    step: 'Waiting',
    checkpoint: 'input-ready',
    projectId: null
  }]);
  this.store.updateItem(item.id, {
    sourcePlatform: source,
    status: 'added',
    retryable: false,
    reason: 'Reference image + ' + source + ' link sent to Automation.',
    title: item.title || productTitle(item.url, source),
    referenceImage,
    automationRowId: rowId
  });
};

// A user selects the image through Electron's native file picker; arbitrary
// local paths are never accepted directly from untrusted renderer content.
AutomateListFeature.prototype.attachReferenceImage = async function attachReferenceImage(itemId, filePath) {
  const data = this.store.read();
  const item = data.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error('The selected list item no longer exists.');
  if (item.status === 'added') throw new Error('This item is already in Automation.');
  if (item.status === 'checking') throw new Error('Wait for the current image check to finish.');
  if (!sourceForUrl(item.url)) throw new Error('A valid HTTPS product URL is required.');
  await validateReferenceImage(filePath);
  this.store.updateItem(itemId, {
    localReferenceImage: filePath,
    sourcePlatform: sourceForUrl(item.url),
    status: 'pending',
    reason: 'Reference image attached. Queued for Automation.',
    updatedAt: new Date().toISOString()
  });
  return this.start();
};

module.exports = { sourceForUrl, validateReferenceImage };
