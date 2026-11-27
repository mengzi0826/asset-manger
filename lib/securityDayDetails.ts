import { z } from "zod";
import { getDB } from "./db";
import { computeTodayStockPnL } from "./history";
import { parseStockSymbol } from "./stocks";
import { parseDbDate, toCnIso, todayCn } from "./time";
import { summarizeSecuritySession, type SecuritySessionSummary } from "./securitySessionSummary";
import { getPortfolioEventCoverage, listPortfolioEvents } from "./portfolioEvents";
export interface SecurityDayDetail {
  operations: string[];
  operationsCovered: boolean;
  session?: SecuritySessionSummary;
}

const rank = z.array(z.object({ name: z.string(), pnl: z.number() })).max(3);
const summarySchema = z.object({
  markets: z.object({ hs: z.number().optional(), hk: z.number().optional(), us: z.number().optional() }),
  winners: rank, losers: rank, usDate: z.string().nullable(), partial: z.boolean()
});

export function securityDayDetails(dates: string[], base: string, current: SecuritySessionSummary) {
  const days: Record<string, SecurityDayDetail> = {};
  const { reliableFrom } = getPortfolioEventCoverage();
  for (const date of dates) {
    days[date] = { operations: [], operationsCovered: !!reliableFrom && date > reliableFrom.slice(0, 10),
      session: undefined };
  }
  const labels = { security_buy: "加仓", security_sell: "减仓", security_liquidation: "清仓",
    security_dividend: "分红", security_trade_undo: "撤回交易", asset_created: "建仓" } as const;
  const events = listPortfolioEvents({ types: ["security_buy", "security_sell", "security_liquidation",
    "security_dividend", "security_trade_undo", "asset_created"], limit: null }).reverse();
  for (const event of events) {
    const day = days[toCnIso(parseDbDate(event.occurredAt)).slice(0, 10)];
    const leg = event.legs.find(item => item.role === "security");
    if (!day || !leg || !(event.type in labels)) continue;
    const label = event.type === "security_buy" && event.metadata?.category_code === "securities"
      ? "建仓" : labels[event.type as keyof typeof labels];
    const amount = event.type === "security_dividend" ? event.grossAmount : leg.quantityDelta;
    const unit = event.type === "security_dividend" ? event.currency : "股";
    day.operations.push(`${label} · ${leg.assetName}${amount == null ? "" : ` · ${Math.abs(amount).toLocaleString("zh-CN")} ${unit}`}`);
  }
  const today = todayCn();
  const snapshots = getDB().prepare(`SELECT date, security_session FROM portfolio_snapshot
    WHERE base_currency = ? AND date < ? AND security_session IS NOT NULL`).all(base, today) as
    {date: string; security_session: string}[];
  for (const row of snapshots) {
    if (!days[row.date]) continue;
    try {
      const parsed = summarySchema.safeParse(JSON.parse(row.security_session));
      if (parsed.success) days[row.date].session = parsed.data;
    } catch { /* Unreadable imported summaries have no verified values. */ }
  }
  restoreObservedSessions(days, base, today);
  if (days[today]) days[today].session = current;
  return days;
}

// Old daily valuations contain prices but no session date or percentage. A dated
// change snapshot can verify the quote when its stored price matches that day's valuation.
function restoreObservedSessions(days: Record<string, SecurityDayDetail>, base: string, today: string) {
  const dates = Object.keys(days).filter(date => date < today && days[date].operationsCovered && !days[date].session).sort();
  if (!dates.length) return;
  const rows = getDB().prepare(`
    WITH observations AS (
      SELECT asset_id, date(created_at, '+8 hours') AS day, snapshot,
        row_number() OVER (PARTITION BY asset_id, date(created_at, '+8 hours')
          ORDER BY julianday(created_at) DESC, id DESC) AS rn
      FROM asset_change WHERE json_valid(snapshot)
        AND date(created_at, '+8 hours') BETWEEN ? AND ?
    )
    SELECT v.date, v.asset_id AS id, v.asset_name AS name, v.currency, v.quantity, v.unit_price AS price,
      json_extract(o.snapshot, '$.symbol') AS symbol,
      CASE WHEN json_extract(o.snapshot, '$.current_price') = v.unit_price
        AND json_extract(o.snapshot, '$.currency') = v.currency
        THEN json_extract(o.snapshot, '$.change_quote_date') END AS sessionDate,
      json_extract(o.snapshot, '$.change_percent') AS pct
    FROM asset_valuation_daily v LEFT JOIN observations o
      ON o.day = v.date AND o.asset_id = v.asset_id AND o.rn = 1
    WHERE v.category_code = 'securities' AND v.base_currency = ? AND v.date BETWEEN ? AND ?
  `).all(dates[0], dates[dates.length - 1], base, dates[0], dates[dates.length - 1]) as {
    date: string; id: number; name: string; currency: string; quantity: number | null; price: number | null;
    symbol: string | null; sessionDate: string | null; pct: number | null;
  }[];
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byDate.get(row.date) ?? [];
    group.push(row);
    byDate.set(row.date, group);
  }
  for (const date of dates) {
    const holdings = (byDate.get(date) ?? []).map(row => ({
      id: row.id, name: row.name, currency: row.currency, quantity: row.quantity ?? 0,
      currentPrice: row.price, changePercent: row.pct, changeQuoteDate: row.sessionDate,
      market: parseStockSymbol(row.symbol)?.market ?? null
    }));
    // Also checks that day's deletion snapshots, including days with no holdings left.
    const result = computeTodayStockPnL(holdings, base, date);
    if (!result.perAsset.size) continue;
    const assets = [...holdings, ...result.closedPositions.map(row => ({
      id: row.id, name: row.name, market: parseStockSymbol(row.symbol)?.market ?? null
    }))];
    // A prior US session is eligible only if we can rule out newer US quotes.
    // Sparse legacy observations cannot establish this across all unknown holdings.
    if (result.sessionDates.us && result.sessionDates.us !== date &&
        holdings.some(row => (!row.market || row.market === "us") && !row.changeQuoteDate)) {
      const usIds = new Set(assets.filter(row => row.market === "us").map(row => row.id));
      for (const id of usIds) result.perAsset.delete(id);
      result.sessionDates.us = null;
    }
    if (!result.perAsset.size) continue;
    const summary = summarizeSecuritySession(result, assets);
    summary.partial = true;
    days[date].session = summary;
  }
}
