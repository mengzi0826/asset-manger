import { getDB } from "./db";
import { todayCn } from "./time";
import { getHistoricalRateAtOrBefore } from "./fx";
import { listPortfolioEvents } from "./portfolioEvents";

export interface ClosedPosition {
  eventId: number;
  assetId: number | null;
  name: string;
  currency: string;
  closedAt: string;
  profit: number | null;
}

export function securityLifetimeProfit(floatingProfit: number | null, base: string) {
  const events = listPortfolioEvents({ types: ["security_sell", "security_liquidation"], limit: null });
  const closed: ClosedPosition[] = [];
  const realized: { date: string; amount: number | null; direction: number }[] = [];
  let total = floatingProfit;
  for (const event of events) {
    const leg = event.legs.find(item => item.role === "security");
    if (!leg) continue;
    if (event.type === "security_sell" && (leg.quantityAfter == null || Math.abs(leg.quantityAfter) > 1e-9)) continue;
    // A later liquidation of an already sold-out row does not close another position.
    if (leg.quantityDelta === 0) continue;
    // The liquidation route preserves the pre-sale cost on the leg. A regular
    // sale can update the broker cost, so only its before value is suitable.
    const cost = event.metadata?.unit_cost_before ??
      (event.type === "security_liquidation" ? leg.unitCostAfter : null);
    const profit = typeof cost === "number" && leg.unitPrice != null && leg.quantityDelta != null && leg.quantityDelta < 0
      ? -leg.quantityDelta * (leg.unitPrice - cost)
      : null;
    const undoneAt = typeof event.metadata?.undone_at === "string" ? event.metadata.undone_at : null;
    if (!undoneAt) closed.push({ eventId: event.id, assetId: leg.assetId ?? null, name: leg.assetName, currency: event.currency, closedAt: event.occurredAt, profit });
    const rate = getHistoricalRateAtOrBefore(event.currency, base, event.occurredAt);
    const amount = profit != null && rate != null ? profit * rate : null;
    realized.push({ date: event.occurredAt.slice(0, 10), amount, direction: 1 });
    if (undoneAt) {
      realized.push({ date: undoneAt.slice(0, 10), amount, direction: -1 });
      continue;
    }
    total = total != null && amount != null ? total + amount : null;
  }
  const today = todayCn();
  // Group all asset rows so a covered day without securities has zero floating P&L.
  // Older portfolio-only snapshots provide no evidence of individual holding costs.
  const days = getDB().prepare(`
    SELECT date, CASE WHEN MAX(CASE WHEN category_code = 'securities'
        AND (quantity IS NULL OR (quantity > 0 AND (unit_cost IS NULL OR unit_price IS NULL OR fx_rate IS NULL)))
        THEN 1 ELSE 0 END) = 1 THEN NULL
      ELSE SUM(CASE WHEN category_code = 'securities' AND quantity > 0
        THEN quantity * (unit_price - unit_cost) * fx_rate ELSE 0 END) END AS floating
    FROM asset_valuation_daily
    WHERE base_currency = ? AND date < ?
    GROUP BY date ORDER BY date
  `).all(base, today) as { date: string; floating: number | null }[];
  realized.sort((a,b) => a.date.localeCompare(b.date));
  let cursor = 0;
  let settled = 0;
  let missing = 0;
  const history = days.map(({ date, floating }) => {
    while (cursor < realized.length && realized[cursor].date <= date) {
      const { amount, direction } = realized[cursor++];
      if (amount == null) missing += direction;
      else settled += direction * amount;
    }
    return { date, pnl: missing === 0 && floating != null ? settled + floating : null };
  });
  history.push({ date: today, pnl: total });
  return { closed, total, history };
}
