const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FlyingResearchFeature } = require('./flyingResearchFeature');

FlyingResearchFeature.prototype.spreadshirt = async function spreadshirt(key) {
  const item = this.eligible(key);
  const source = await this.cacheImage(item);
  const dir = path.join(app.getPath('userData'), 'flying-spreadshirt-inputs', crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const referencePath = path.join(dir, `reference${path.extname(source)}`);
  fs.copyFileSync(source, referencePath);
  return {
    referencePath,
    sourceUrl: item.canonicalUrl,
    title: item.title,
    researchKey: item.key,
    marketplace: item.marketplace,
    asin: item.asin
  };
};

module.exports = {};
