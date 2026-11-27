import type { StockMarket } from "./stocks";
import type { computeTodayStockPnL } from "./history";

export interface SecuritySessionSummary {
  markets: Partial<Record<StockMarket, number>>;
  winners: { name: string; pnl: number }[];
  losers: { name: string; pnl: number }[];
  usDate: string | null;
  partial: boolean;
}

export function summarizeSecuritySession(result: ReturnType<typeof computeTodayStockPnL>,
  assets: { id: number; name: string; market: StockMarket | null }[]): SecuritySessionSummary {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const markets: SecuritySessionSummary["markets"] = {};
  const ranks: SecuritySessionSummary["winners"] = [];
  let partial = result.status === "partial";
  for (const entry of result.perAsset.values()) {
    const asset = byId.get(entry.assetId);
    if (!asset) { partial = true; continue; }
    const pnl = entry.todayPnLBase;
    ranks.push({ name: asset.name, pnl });
    if (asset.market) markets[asset.market] = (markets[asset.market] ?? 0) + pnl;
    else partial = true;
  }
  ranks.sort((a, b) => b.pnl - a.pnl || a.name.localeCompare(b.name));
  return { markets, winners: ranks.filter(row => row.pnl > 0).slice(0, 3),
    losers: ranks.filter(row => row.pnl < 0).reverse().slice(0, 3),
    usDate: result.sessionDates.us, partial };
}
