const { ZeroPODBuiltInProvider } = require('./researchProvider');
const { assessTrademarkRisk } = require('./researchTrademarkSafety');

const originalRefreshBestSellers = ZeroPODBuiltInProvider.prototype.refreshBestSellers;
const originalImportProduct = ZeroPODBuiltInProvider.prototype.importProduct;

function persistAssessment(provider, item, assessment) {
  return provider.store.upsert({
    ...item,
    trademarkRisk: Boolean(assessment.risky),
    trademarkRiskReason: assessment.reason || null,
    trademarkRiskMatched: assessment.matched || null,
    trademarkCheckedAt: new Date().toISOString()
  });
}

ZeroPODBuiltInProvider.prototype.refreshBestSellers = async function refreshTrademarkSafeResearch(payload = {}) {
  const result = await originalRefreshBestSellers.call(this, payload);
  const sourceItems = Array.isArray(result.items) ? result.items : [];
  const safe = [];
  let trademarkSkippedCount = 0;

  for (const item of sourceItems) {
    const assessment = assessTrademarkRisk(item);
    const updated = persistAssessment(this, item, assessment);
    if (assessment.risky) trademarkSkippedCount += 1;
    else safe.push(updated);
  }

  return {
    ...result,
    preTrademarkCount: sourceItems.length,
    trademarkSkippedCount,
    count: safe.length,
    items: safe
  };
};

ZeroPODBuiltInProvider.prototype.importProduct = async function importTrademarkCheckedProduct(value, marketplaceHint = null) {
  const item = await originalImportProduct.call(this, value, marketplaceHint);
  const assessment = assessTrademarkRisk(item);
  return persistAssessment(this, item, assessment);
};

module.exports = {};
