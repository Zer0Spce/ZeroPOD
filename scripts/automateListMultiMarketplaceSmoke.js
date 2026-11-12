'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { AutomateListFeature } = require('../src/main/automateListFeature');
require('../src/main/automateListReliabilityPatch');
const { sourceForUrl, validateReferenceImage } = require('../src/main/automateListMultiMarketplacePatch');

(async () => {
  const cases = [
    ['https://www.amazon.com/dp/B012345678', 'Amazon'],
    ['https://www.etsy.com/listing/123/sample-shirt', 'Etsy'],
    ['https://www.redbubble.com/i/t-shirt/example/123', 'Redbubble'],
    ['https://www.teepublic.com/t-shirt/456/example', 'TeePublic'],
    ['https://www.zazzle.com/example', 'Zazzle'],
    ['https://www.threadless.com/shop/example', 'Threadless'],
    ['https://example.org/products/shirt', 'Other'],
    ['file:///etc/passwd', null],
    ['http://example.com/test', null],
    ['https://127.0.0.1/private', null]
  ];
  cases.forEach(([url, expected]) => assert.strictEqual(sourceForUrl(url), expected, url));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-source-test-'));
  try {
    const image = path.join(dir, 'reference.png');
    await sharp({
      create: { width: 800, height: 800, channels: 4, background: { r: 10, g: 80, b: 180, alpha: 1 } }
    }).png().toFile(image);
    await validateReferenceImage(image);

    const items = [{ id: 'sample', url: 'https://www.etsy.com/listing/123/sample-shirt', status: 'pending' }];
    const rows = [];
    const feature = Object.create(AutomateListFeature.prototype);
    feature.store = {
      read: () => ({ items }),
      updateItem: (id, patch) => Object.assign(items.find((item) => item.id === id), patch)
    };
    feature.automationStore = { addRows: (batch) => rows.push(...batch) };
    feature.existingAutomationDuplicate = () => null;
    feature.automationHasSpace = () => true;
    feature.copyIntoAutomationStorage = () => image;
    feature.start = () => ({ items });

    await feature.processItem(items[0]);
    assert.strictEqual(items[0].status, 'needs-image');
    await feature.attachReferenceImage('sample', image);
    await feature.processItem(items[0]);
    assert.strictEqual(items[0].status, 'added');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].amazonLink, items[0].url);
    assert.strictEqual(rows[0].referenceImage, image);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('Mixed marketplace Automate List smoke test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
