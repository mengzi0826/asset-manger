import { getDB, type AssetValuationDaily, type PortfolioSnapshot } from "./db";
import { getRate } from "./fx";
import { getPortfolioEventCoverage, listPortfolioEvents } from "./portfolioEvents";
import { calculateNetWorthChange } from "./netWorthChange";
import { nowCn, todayCn } from "./time";
import type { valueAll } from "./valuation";

/** 一次批量读取历史，避免每个图表点分别查询事件与估值。 */
export function buildNetWorthHistory(
  snapshots: PortfolioSnapshot[],
  live?: { baseCurrency: string; valuation: ReturnType<typeof valueAll> }
) {
  const points = [...snapshots];
  let currentAssets: AssetValuationDaily[] | undefined;
  if (live) {
    const date = todayCn(), capturedAt = nowCn();
    const current: PortfolioSnapshot = {
      id: -1, date, base_currency: live.baseCurrency,
      total_value: live.valuation.total, breakdown: JSON.stringify(live.valuation.byCategory), created_at: capturedAt
    };
    const index = points.findIndex(point => point.date === date);
    if (index < 0) points.push(current); else points[index] = current;
    currentAssets = live.valuation.items.map(item => ({
      date, base_currency: live.baseCurrency, asset_id: item.id, account_id: item.account_id,
      asset_name: item.name, category_code: item.category_code, currency: item.currency,
      quantity: item.quantity, unit_cost: item.unit_cost,
      unit_price: item.current_price ?? item.unit_cost, amount: item.amount,
      native_value: item.native_value, fx_rate: getRate(item.currency, live.baseCurrency),
      base_value: item.base_value, captured_at: capturedAt
    }));
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return [];
  const db = getDB(), base = points[0].base_currency;
  // 图表第一个可见点也应与范围外最近的快照比较。
  let previous = db.prepare(`SELECT * FROM portfolio_snapshot WHERE base_currency = ? AND date < ?
    ORDER BY date DESC LIMIT 1`).get(base, points[0].date) as PortfolioSnapshot | undefined;
  const from = previous?.date ?? points[0].date, to = points.at(-1)!.date;
  const rows = db.prepare(`SELECT * FROM asset_valuation_daily WHERE base_currency = ? AND date BETWEEN ? AND ?
    ORDER BY date, asset_id`).all(base, from, to) as AssetValuationDaily[];
  const byDate = new Map<string, AssetValuationDaily[]>();
  for (const row of rows) {
    const entries = byDate.get(row.date) ?? [];
    entries.push(row); byDate.set(row.date, entries);
  }
  if (currentAssets) byDate.set(todayCn(), currentAssets);
  const events = listPortfolioEvents({ fromDate: from, toDate: to, limit: null });
  const { reliableFrom } = getPortfolioEventCoverage();
  let eventIndex = 0;
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
  return points.map(current => {
    const intervalEvents = [];
    while (eventIndex < events.length && events[eventIndex].occurredAt.slice(0, 10) <= current.date) {
      const event = events[eventIndex++];
      if (previous && event.occurredAt.slice(0, 10) > previous.date) intervalEvents.push(event);
    }
    const change = calculateNetWorthChange({
      previous, current, previousAssets: previous ? byDate.get(previous.date) ?? [] : [],
      currentAssets: byDate.get(current.date) ?? [], events: intervalEvents, reliableFrom
    });
    previous = current;
    return { date: current.date, total_value: current.total_value, change };
  });
}
