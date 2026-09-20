import { getDB, getSetting } from "@/lib/db";
import { getLastFxRefreshAt, getLastFxRefreshError } from "@/lib/fx";
import { listSnapshots } from "@/lib/history";
import { getJuheFxAppKey, getJuheStockAppKey } from "@/lib/juheKeys";
import { getLastStocksRefreshAt, getLastStocksRefreshError } from "@/lib/stocks";
import { isWeekendBeijing, shouldRefreshFxEvery8h, shouldRefreshStocksBy10And14, todayCn } from "@/lib/time";
import { formatCnDateTime } from "@/lib/utils";
import { DashboardStatusBar } from "./DashboardStatusBar";
import { DataFreshnessLine } from "./DataFreshness";

export function AppStatusBar() {
  const db = getDB();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const assetStats = db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS lastUpdated FROM asset").get() as {
    count: number;
    lastUpdated: string | null;
  };
  const accountCount = (db.prepare("SELECT COUNT(*) AS count FROM account").get() as { count: number }).count;
  const snapshotCount = listSnapshots(baseCurrency, 365).length;
  const fxLast = getLastFxRefreshAt();
  const stocksLast = getLastStocksRefreshAt();

  return (
    <DashboardStatusBar>
      <div className="dashboard-footer-stats">
        <span>{assetStats.count} 笔资产</span>
        <span>{accountCount} 个账户</span>
        {snapshotCount > 0 && <span>{snapshotCount} 个历史快照</span>}
        {assetStats.lastUpdated && <span className="tabular">资产更新 {formatCnDateTime(assetStats.lastUpdated)}</span>}
      </div>
      <DataFreshnessLine
        weekend={isWeekendBeijing(todayCn())}
        fxConfigured={getJuheFxAppKey() !== ""}
        fxLast={fxLast}
        fxError={getLastFxRefreshError()}
        fxStale={shouldRefreshFxEvery8h(fxLast)}
        stocksConfigured={getJuheStockAppKey() !== ""}
        stocksLast={stocksLast}
        stocksError={getLastStocksRefreshError()}
        stocksStale={shouldRefreshStocksBy10And14(stocksLast)}
      />
    </DashboardStatusBar>
  );
}
