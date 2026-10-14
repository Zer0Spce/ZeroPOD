const videoFlow = require('./spreadshirtVideoFlowPatch');
const {
  enableMarketplaceCustomToggle
} = require('./spreadshirtMarketplaceTogglePatch');

async function enableSpreadshirtMarketplaceBridged(page) {
  const result = await enableMarketplaceCustomToggle(page);
  return Boolean(result?.ok);
}

// The post-upload prepare layer imports this helper from spreadshirtVideoFlowPatch.
// Override that export before spreadshirtPostUploadCardVerifyPatch loads so the
// final workflow uses the visible-wrapper/native-checkbox implementation rather
// than Playwright check()/click() on Spreadshirt's hidden <input type="checkbox">.
videoFlow.enableSpreadshirtMarketplace = enableSpreadshirtMarketplaceBridged;

module.exports = {
  enableSpreadshirtMarketplaceBridged
};
