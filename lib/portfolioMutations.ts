import { getDB, getSetting, type AssetRow } from "./db";
import { logAssetChange, recordSnapshot } from "./history";
import { recordPortfolioEvent } from "./portfolioEvents";
import { computeAssetValue } from "./valuation";

/** 业务、事件、当天总快照和逐资产明细一起提交；失败时一起回滚。 */
export function portfolioTransaction<T>(work: () => T): () => T {
  return getDB().transaction(() => {
    const result = work();
    recordSnapshot(getSetting("base_currency") ?? "CNY");
    return result;
  });
}

export function recordAssetRemoval(asset: AssetRow, categoryCode: string, reason: string) {
  const isSecurity = categoryCode === "securities";
  recordPortfolioEvent({
    type: "asset_deleted",
    currency: asset.currency,
    grossAmount: computeAssetValue(asset),
    reason,
    metadata: { category_code: categoryCode, classification: "record_adjustment" },
    legs: [{
      assetId: asset.id, accountId: asset.account_id, assetName: asset.name,
      role: isSecurity ? "security" : categoryCode === "cash" ? "cash" : "asset",
      amountDelta: !isSecurity && asset.amount != null ? -asset.amount : null,
      amountAfter: !isSecurity && asset.amount != null ? 0 : null,
      quantityDelta: isSecurity ? -(asset.quantity ?? 0) : null,
      quantityAfter: isSecurity ? 0 : null,
      unitPrice: isSecurity ? asset.current_price ?? asset.unit_cost : null,
      unitCostAfter: isSecurity ? asset.unit_cost : null
    }]
  });
  logAssetChange({ action: "delete", before: asset });
}
