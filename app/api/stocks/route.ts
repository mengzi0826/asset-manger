import { NextResponse } from "next/server";
import {
  getLastStocksRefreshAt,
  listSecuritiesForView,
  refreshStockPrices
} from "@/lib/stocks";
import { nextStockAutoRefreshIso } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  if (refresh) {
    const result = await refreshStockPrices({ force: true });
    return NextResponse.json({
      items: listSecuritiesForView(),
      last_refreshed_at: result.last_refreshed_at,
      next_refresh_at: result.next_refresh_at,
      refresh: result
    });
  }

  return NextResponse.json({
    items: listSecuritiesForView(),
    last_refreshed_at: getLastStocksRefreshAt(),
    next_refresh_at: nextStockAutoRefreshIso(),
    refresh: null
  });
}
