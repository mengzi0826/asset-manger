import type { AssetValuationDaily } from "./db";

type FxValuation = Pick<AssetValuationDaily, "currency" | "category_code" | "native_value" | "fx_rate" | "base_value">;

export interface FxImpactEntry {
  currency: string;
  previousNativeValue: number;
  currentNativeValue: number;
  previousRate: number | null;
  currentRate: number | null;
  baseValueChange: number;
  /** 对称分解：平均原币敞口 × 汇率变化。 */
  fxImpact: number | null;
  /** 对称分解：原币价值变化 × 平均汇率，包含资金流、交易与市场波动。 */
  nativeValueImpact: number | null;
  comparable: boolean;
}

export function netValueSign(category: string): number {
  return category === "liability" ? -1 : 1;
}

function summarizeEndpoint(rows: FxValuation[], snapshotTotal: number | undefined) {
  const buckets = new Map<string, { nativeValue: number; baseValue: number; rate: number | null }>();
  let baseValue = 0;
  for (const row of rows) {
    const sign = netValueSign(row.category_code);
    const rate = row.fx_rate;
    const converted = rate == null ? NaN : row.native_value * rate;
    const validRate = rate != null && Number.isFinite(rate) && rate > 0 &&
      Number.isFinite(converted) && Number.isFinite(row.base_value) &&
      Math.abs(converted - row.base_value) < 1e-6 * Math.max(1, Math.abs(converted), Math.abs(row.base_value))
      ? rate : null;
    const bucket = buckets.get(row.currency);
    if (bucket) {
      bucket.nativeValue += sign * row.native_value;
      bucket.baseValue += sign * row.base_value;
      if (bucket.rate !== validRate) bucket.rate = null;
    } else {
      buckets.set(row.currency, { nativeValue: sign * row.native_value, baseValue: sign * row.base_value, rate: validRate });
    }
    baseValue += sign * row.base_value;
  }
  // 空明细无法区分空仓与旧版快照缺失，必须由可对账的逐资产明细建立覆盖。
  const covered = rows.length > 0 && snapshotTotal != null && Math.abs(baseValue - snapshotTotal) < 0.01;
  return { buckets, baseValue, covered };
}

/** 净值明细和历史汇率报表共享两端覆盖校验与对称分解。 */
export function calculateHistoricalFxImpact(
  previousRows: FxValuation[],
  currentRows: FxValuation[],
  previousTotal: number | undefined,
  currentTotal: number | undefined
) {
  const previous = summarizeEndpoint(previousRows, previousTotal);
  const current = summarizeEndpoint(currentRows, currentTotal);
  const covered = previous.covered && current.covered;
  const byCurrency: FxImpactEntry[] = [];
  const averageRates = new Map<string, number>();
  for (const currency of new Set([...previous.buckets.keys(), ...current.buckets.keys()])) {
    const left = previous.buckets.get(currency);
    const right = current.buckets.get(currency);
    const previousNativeValue = left?.nativeValue ?? 0;
    const currentNativeValue = right?.nativeValue ?? 0;
    const previousRate = left?.rate ?? null;
    const currentRate = right?.rate ?? null;
    let fxImpact = null;
    let nativeValueImpact = null;
    if (covered && previousRate != null && currentRate != null) {
      const averageRate = (previousRate + currentRate) / 2;
      averageRates.set(currency, averageRate);
      fxImpact = (previousNativeValue + currentNativeValue) / 2 * (currentRate - previousRate);
      nativeValueImpact = (currentNativeValue - previousNativeValue) * averageRate;
    }
    byCurrency.push({
      currency, previousNativeValue, currentNativeValue, previousRate, currentRate,
      baseValueChange: (right?.baseValue ?? 0) - (left?.baseValue ?? 0),
      fxImpact, nativeValueImpact, comparable: fxImpact != null
    });
  }
  const totalBaseValueChange = previousTotal != null && currentTotal != null
    ? currentTotal - previousTotal
    : current.baseValue - previous.baseValue;
  return { covered, byCurrency, averageRates, totalBaseValueChange };
}
