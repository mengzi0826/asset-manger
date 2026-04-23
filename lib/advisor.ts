import { differenceInDays } from "date-fns";
import type { CategoryCode } from "./db";
import type { ValuedAsset } from "./valuation";

export type SuggestionLevel = "info" | "warn" | "danger";

export interface Suggestion {
  level: SuggestionLevel;
  title: string;
  detail: string;
}

export function buildSuggestions(params: {
  items: ValuedAsset[];
  total: number;
  byCategory: Record<CategoryCode, number>;
  baseCurrency: string;
}): Suggestion[] {
  const { items, total, byCategory, baseCurrency } = params;
  const suggestions: Suggestion[] = [];
  const liabilityTotal = byCategory.liability ?? 0;
  // total 是净资产（总资产 - 总负债），推回总资产作为大类占比的分母
  const assetTotal = total + liabilityTotal;
  if (assetTotal <= 0 || items.length === 0) {
    suggestions.push({
      level: "info",
      title: "尚未录入资产",
      detail: "请在「资产」页添加你的第一笔资产，开始记录吧。"
    });
    return suggestions;
  }

  const pct = (code: CategoryCode) => (byCategory[code] ?? 0) / assetTotal;

  if (pct("cash") > 0.3) {
    suggestions.push({
      level: "warn",
      title: `现金占比过高 ${(pct("cash") * 100).toFixed(0)}%`,
      detail: "闲置现金超过 30%，可考虑货币基金、T+0 理财或短期存款以提升收益。"
    });
  }

  const labels: Record<CategoryCode, string> = {
    cash: "现金",
    deposit: "存款/理财",
    fund: "基金",
    securities: "证券/股票",
    crypto: "加密货币",
    liability: "负债",
    other: "其他"
  };

  for (const code of Object.keys(byCategory) as CategoryCode[]) {
    if (code === "liability") continue;
    if (pct(code) > 0.6) {
      suggestions.push({
        level: "warn",
        title: `${labels[code]}过度集中 ${(pct(code) * 100).toFixed(0)}%`,
        detail: `单一大类占比过高，建议逐步分散到其他资产类型以降低相关性风险。`
      });
    }
  }

  // 负债提示
  if (liabilityTotal > 0) {
    const leverageRatio = liabilityTotal / assetTotal;
    if (total < 0) {
      suggestions.push({
        level: "danger",
        title: "净资产为负",
        detail: `总负债 ${liabilityTotal.toFixed(0)} ${baseCurrency} 已超过总资产，建议优先偿还高息负债并控制新增借贷。`
      });
    } else if (leverageRatio > 0.5) {
      suggestions.push({
        level: "danger",
        title: `负债率偏高 ${(leverageRatio * 100).toFixed(0)}%`,
        detail: "负债超过总资产的 50%，流动性风险较大，建议制定清晰的还款计划。"
      });
    } else if (leverageRatio > 0.3) {
      suggestions.push({
        level: "warn",
        title: `负债率 ${(leverageRatio * 100).toFixed(0)}%`,
        detail: "负债占比接近中等水平，注意保留足够的现金流以覆盖月供。"
      });
    }

    const liquidity = (byCategory.cash ?? 0) + (byCategory.deposit ?? 0);
    if (liquidity > 0 && liquidity < liabilityTotal * 0.1) {
      suggestions.push({
        level: "warn",
        title: "流动性储备偏低",
        detail: "现金 + 存款不足负债的 10%，建议保留 3~6 个月月供的应急资金。"
      });
    }
  }

  if (pct("crypto") > 0.2) {
    suggestions.push({
      level: "danger",
      title: `加密货币占比 ${(pct("crypto") * 100).toFixed(0)}%`,
      detail: "高波动资产占比偏高，请评估自己的风险承受能力并做好止损预案。"
    });
  }

  const now = new Date();
  const upcoming = items.filter((a) => {
    if (!a.maturity_date) return false;
    const d = new Date(a.maturity_date);
    if (Number.isNaN(d.getTime())) return false;
    const delta = differenceInDays(d, now);
    return delta >= 0 && delta <= 30;
  });
  if (upcoming.length > 0) {
    suggestions.push({
      level: "info",
      title: `${upcoming.length} 笔存款/理财即将到期`,
      detail: upcoming
        .map((a) => `${a.name}（${a.maturity_date}）`)
        .join("、") + "；请提前安排续存或转出。"
    });
  }

  const hasForeign = items.some((a) => a.currency !== "CNY");
  if (!hasForeign) {
    const threshold = baseCurrency === "CNY" ? 500_000 : 70_000;
    if (total > threshold) {
      suggestions.push({
        level: "info",
        title: "缺少外币资产",
        detail: `总资产已超过 ${baseCurrency === "CNY" ? "50 万元" : "7 万美元"}，可考虑少量配置外币（如美元）以分散汇率风险。`
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      level: "info",
      title: "资产配置看起来不错",
      detail: "当前组合相对均衡。建议定期复盘，并关注到期、分红与再平衡。"
    });
  }

  return suggestions;
}
