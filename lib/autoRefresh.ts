import "server-only";
import { refreshRates } from "./fx";
import { refreshStockPrices } from "./stocks";

const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;

type AutoRefreshGlobal = typeof globalThis & {
  __assetManagerAutoRefreshStarted?: boolean;
};

let tickInFlight = false;

async function runAutoRefreshTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await refreshRates(false);
    await refreshStockPrices({ force: false });
  } catch (e: any) {
    console.warn("[auto-refresh] tick failed:", e?.message ?? e);
  } finally {
    tickInFlight = false;
  }
}

export function startAutoRefreshScheduler(): void {
  const g = globalThis as AutoRefreshGlobal;
  if (g.__assetManagerAutoRefreshStarted) return;
  g.__assetManagerAutoRefreshStarted = true;

  // 进程启动后尽快检查一次，后续按固定间隔轮询。
  void runAutoRefreshTick();
  const timer = setInterval(() => {
    void runAutoRefreshTick();
  }, AUTO_REFRESH_INTERVAL_MS);
  timer.unref?.();

  console.log(`[auto-refresh] scheduler started, interval=${AUTO_REFRESH_INTERVAL_MS}ms`);
}
