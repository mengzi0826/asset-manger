/** 日息 = 本金 × 年化利率 / 365，四舍五入到分。利率为小数，0.02 表示 2%。 */
export const INTEREST_DAY_COUNT = 365;

export const INTEREST_BUCKETS = [
  { id: "cny", label: "人民币利息", category: "cash", currency: "CNY", settingKey: "interest_annual_rate_cny" },
  { id: "hkd", label: "港币利息", category: "cash", currency: "HKD", settingKey: "interest_annual_rate_hkd" },
  { id: "usd", label: "美元利息", category: "cash", currency: "USD", settingKey: "interest_annual_rate_usd" },
  { id: "crypto", label: "加密货币利息", category: "crypto", currency: "USD", settingKey: "interest_annual_rate_crypto" }
] as const;

export type InterestBucketId = (typeof INTEREST_BUCKETS)[number]["id"];
export type InterestBucket = (typeof INTEREST_BUCKETS)[number];

export function interestBucketById(id: string): InterestBucket | undefined {
  return INTEREST_BUCKETS.find((bucket) => bucket.id === id);
}

export function interestNote(id: InterestBucketId): string {
  return `interest:${id}`;
}

/** 年化利率小数。空值视为 0；超出 0–500% 直接拒绝。 */
export function normalizeAnnualRate(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 5) throw new Error("年化利率需在 0% 到 500% 之间");
  return Math.round(value * 1e8) / 1e8;
}

export function dailyInterest(principal: number, annualRate: number): number {
  if (!(principal > 0) || !(annualRate > 0)) return 0;
  return Math.round((principal * annualRate) / INTEREST_DAY_COUNT * 100) / 100;
}

export function moneyCents(value: number): number {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100);
}

export interface InterestBucketStatus {
  id: InterestBucketId;
  label: string;
  currency: string;
  category: "cash" | "crypto";
  annualRate: number;
  /** 已入账日用锁定本金，否则用当前余额。 */
  principal: number;
  todayInterest: number;
  accrued: boolean;
}
