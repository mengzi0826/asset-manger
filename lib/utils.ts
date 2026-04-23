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
