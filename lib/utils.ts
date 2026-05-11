import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatCnDate } from "./time";

export { formatCnDate, formatCnDateTime } from "./time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value: number, currency: string = "CNY", digits = 2) {
  const n = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
}

export function formatPercent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(s?: string | null) {
  return formatCnDate(s);
}

/**
 * 大数字紧凑格式化：
 *   - >=1 亿 → "1.23 亿"
 *   - >=1 万 → "1.20 万"
 *   - >=1 千 → "1.2k"   （仅在启用 `useK` 时；默认不缩到 k，让千位级别保留普通分隔符更直观）
 *   - 其余 → 普通千分位 + 指定小数位
 *
 * 与 `formatMoney` 的区别：本函数只输出纯数字（不带货币符号），适合图表轴 / 行内紧凑展示。
 *
 * 示例：
 *   formatCompact(1234567)       → "123.46 万"
 *   formatCompact(1234567, {useK: true}) → "1.2k" 不会出现，万级直接到 万
 *   formatCompact(523.4, {digits: 1}) → "523.4"
 */
export function formatCompact(
  value: number,
  options: { digits?: number; useK?: boolean } = {}
): string {
  const { digits = 1, useK = false } = options;
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)} 万`;
  if (useK && abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

/**
 * 带正负号的紧凑格式化（"+1.23 万" / "-3.5k"）。
 * 用于"今日盈亏 / 累计变化"等需要直观看出方向的场景。
 */
export function formatCompactSigned(
  value: number,
  options?: { digits?: number; useK?: boolean }
): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatCompact(Math.abs(value), options)}`;
}
