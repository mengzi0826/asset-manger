import { addDays, format, parseISO, subDays } from "date-fns";
import { getDB, type PortfolioSnapshot } from "./db";

/** 区间计算共用明确的历史端点；不以当前持仓或当前汇率重估历史。 */
export function summarizePortfolioPeriod(baseCurrency: string, from: string, to: string) {
  const db = getDB();
  const baseline = db.prepare(`SELECT * FROM portfolio_snapshot WHERE base_currency = ? AND date < ?
    ORDER BY date DESC LIMIT 1`).get(baseCurrency, from) as PortfolioSnapshot | undefined;
  const snapshots = db.prepare(`SELECT * FROM portfolio_snapshot WHERE base_currency = ? AND date BETWEEN ? AND ?
    ORDER BY date`).all(baseCurrency, from, to) as PortfolioSnapshot[];
  const ending = snapshots.at(-1);
  const expectedBaseline = format(subDays(parseISO(from), 1), "yyyy-MM-dd");
  const metric = (snapshot: PortfolioSnapshot | undefined) => {
    if (!snapshot) return null;
    let liabilities: number | null = null;
    try {
      const breakdown = JSON.parse(snapshot.breakdown ?? "null");
      if (breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)) {
        const value = Number(breakdown.liability ?? 0);
        if (Number.isFinite(value)) liabilities = value;
      }
    } catch { /* 旧快照分类缺失不能用当前负债补齐 */ }
    return { date: snapshot.date, capturedAt: snapshot.created_at, netWorth: snapshot.total_value,
      totalLiabilities: liabilities, totalAssets: liabilities == null ? null : snapshot.total_value + liabilities };
  };
  const start = metric(baseline), end = metric(ending);
  const dates = new Set(snapshots.map(s => s.date));
  const missingSnapshotDates: string[] = [];
  for (let day = parseISO(from); format(day, "yyyy-MM-dd") <= to; day = addDays(day, 1)) {
    const ymd = format(day, "yyyy-MM-dd");
    if (!dates.has(ymd)) missingSnapshotDates.push(ymd);
  }
  return {
    requestedFrom: from, requestedTo: to, baseCurrency,
    status: !start || !end ? "unavailable" : baseline!.date === expectedBaseline && ending!.date === to ? "complete" : "partial",
    start, end,
    netWorthChange: start && end ? end.netWorth - start.netWorth : null,
    totalAssetsChange: start?.totalAssets != null && end?.totalAssets != null ? end.totalAssets - start.totalAssets : null,
    liabilitiesChange: start?.totalLiabilities != null && end?.totalLiabilities != null ? end.totalLiabilities - start.totalLiabilities : null,
    missingSnapshotDates,
    snapshots,
    basis: "每天最后一次已记录的估值；变化金额不是投资收益；实际端点不同于请求端点时只代表观测区间。"
  };
}
