import { NextResponse } from "next/server";
import {
  getLastStocksRefreshAt,
  listSecuritiesForView,
  refreshStockPrices
} from "@/lib/stocks";
import { nextStockAutoRefreshIso } from "@/lib/time";

function nextRefreshAt(): string {
  return nextStockAutoRefreshIso(getLastStocksRefreshAt());
}

export const dynamic = "force-dynamic";
/** 腾讯批量行情一次返回全部持仓；保留较长执行时间，避免手动刷新被平台截断。 */
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const rawMarket = url.searchParams.get("market");
  const market = rawMarket === "hs" || rawMarket === "hk" || rawMarket === "us"
    ? rawMarket
    : undefined;

  if (rawMarket && !market) {
    return NextResponse.json({ error: "market 只支持 hs / hk / us" }, { status: 400 });
  }

  try {
    if (refresh) {
      const result = await refreshStockPrices({ force: true, market });
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
      next_refresh_at: nextRefreshAt(),
      refresh: null
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/stocks]", e);
    let itemsOut: ReturnType<typeof listSecuritiesForView> = [];
    try {
      itemsOut = refresh ? listSecuritiesForView() : [];
    } catch {
      /* 避免错误处理里再抛导致仍无 JSON */
    }
    return NextResponse.json(
      {
        error: message || "服务器错误",
        items: itemsOut,
        last_refreshed_at: refresh ? getLastStocksRefreshAt() : null,
        next_refresh_at: nextRefreshAt(),
        refresh: refresh
          ? {
              last_refreshed_at: getLastStocksRefreshAt(),
              next_refresh_at: nextRefreshAt(),
              skipped: null,
              updated_count: 0,
              failed_count: 0,
              error: message,
              items: []
            }
          : null
      },
      { status: 500 }
    );
  }
}
