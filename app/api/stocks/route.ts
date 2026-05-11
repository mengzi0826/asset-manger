import { NextResponse } from "next/server";
import {
  getLastStocksRefreshAt,
  listSecuritiesForView,
  refreshStockPrices
} from "@/lib/stocks";
import { nextStockAutoRefreshIso } from "@/lib/time";

export const dynamic = "force-dynamic";
/** 多标的串行拉取 Juhe，易超过默认 Serverless 上限；部署到 Vercel 等时延长可执行时间 */
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  try {
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
        next_refresh_at: nextStockAutoRefreshIso(),
        refresh: refresh
          ? {
              last_refreshed_at: getLastStocksRefreshAt(),
              next_refresh_at: nextStockAutoRefreshIso(),
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
