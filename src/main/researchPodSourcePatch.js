const { BEST_SELLER_PRESETS } = require('./researchProvider');

// Keep Research focused on print-on-demand style apparel instead of broad fashion nodes.
// This is deliberately a tiny adapter so the proven Research provider/browser flow stays intact.
if (BEST_SELLER_PRESETS?.US) {
  BEST_SELLER_PRESETS.US.tshirt = {
    label: "Men's Novelty T-Shirts",
    url: 'https://www.amazon.com/Best-Sellers-Mens-Novelty-T-Shirts/zgbs/fashion/9056987011'
  };

  // Broad Clothing, Shoes & Jewelry is intentionally not exposed as a POD Best Sellers preset.
  delete BEST_SELLER_PRESETS.US.clothing;
}

module.exports = {};
