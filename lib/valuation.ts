import { getDB, type AssetRow, type AssetWithMeta, type CategoryCode } from "./db";
import { convert } from "./fx";

export function computeAssetValue(asset: AssetRow): number {
  if (asset.amount != null && asset.amount > 0) return asset.amount;
  const price = asset.current_price ?? asset.unit_cost ?? 0;
  return (asset.quantity ?? 0) * price;
}

export function computeProfit(asset: AssetRow): number | null {
  if (asset.unit_cost == null || asset.current_price == null) return null;
  const qty = asset.quantity ?? 0;
  return qty * (asset.current_price - asset.unit_cost);
}

export function computeProfitRate(asset: AssetRow): number | null {
  if (asset.unit_cost == null || asset.current_price == null || asset.unit_cost === 0) return null;
  return (asset.current_price - asset.unit_cost) / asset.unit_cost;
}

export interface ValuedAsset extends AssetWithMeta {
  native_value: number;
  base_value: number;
  profit_native: number | null;
  profit_rate: number | null;
}

export function listAssetsWithMeta(): AssetWithMeta[] {
  const db = getDB();
  return db
    .prepare(
      `SELECT a.*, acc.name AS account_name, acc.category_id AS category_id,
              c.code AS category_code, c.name AS category_name
       FROM asset a
       JOIN account acc ON acc.id = a.account_id
       JOIN category c ON c.id = acc.category_id
       ORDER BY c.sort_order, acc.name, a.name`
    )
    .all() as AssetWithMeta[];
}

export function valueAll(baseCurrency: string): {
  items: ValuedAsset[];
  /** 净资产 = 总资产 - 总负债。为兼容历史语义保留 total 字段。 */
  total: number;
  /** 资产端合计（不含负债） */
  totalAssets: number;
  /** 负债合计（正数） */
  totalLiabilities: number;
  /** 净资产：等同于 total，显式字段便于阅读 */
  netWorth: number;
  /** 按大类合计（正数）；负债大类单独存放 */
  byCategory: Record<CategoryCode, number>;
  missingRates: string[];
} {
  const items = listAssetsWithMeta();
  let totalAssets = 0;
  let totalLiabilities = 0;
  const byCategory: Record<string, number> = {};
  const missingRates = new Set<string>();
  const valued: ValuedAsset[] = items.map((a) => {
    const native = computeAssetValue(a);
    const base = convert(native, a.currency, baseCurrency);
    if (base == null) missingRates.add(`${a.currency}->${baseCurrency}`);
    const bv = base ?? 0;
    if (a.category_code === "liability") {
      totalLiabilities += bv;
    } else {
      totalAssets += bv;
    }
    byCategory[a.category_code] = (byCategory[a.category_code] || 0) + bv;
    return {
      ...a,
      native_value: native,
      base_value: bv,
      profit_native: computeProfit(a),
      profit_rate: computeProfitRate(a)
    };
  });
  const netWorth = totalAssets - totalLiabilities;
  return {
    items: valued,
    total: netWorth,
    totalAssets,
    totalLiabilities,
    netWorth,
    byCategory: byCategory as Record<CategoryCode, number>,
    missingRates: Array.from(missingRates)
  };
}
