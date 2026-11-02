import { getDB, getSetting } from "@/lib/db";
import { listSnapshots } from "@/lib/history";
import { getMarketFreshness } from "@/lib/marketFreshness";
import { formatCnDateTime } from "@/lib/utils";
import { DashboardStatusBar } from "./DashboardStatusBar";
import { MarketFreshnessLive } from "./MarketFreshnessLive";

export function AppStatusBar() {
  const db = getDB();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const assetStats = db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS lastUpdated FROM asset").get() as {
    count: number;
    lastUpdated: string | null;
  };
  const accountCount = (db.prepare("SELECT COUNT(*) AS count FROM account").get() as { count: number }).count;
  const snapshotCount = listSnapshots(baseCurrency, 365).length;

  return (
    <DashboardStatusBar>
      <div className="dashboard-footer-stats">
        <span>{assetStats.count} 笔资产</span>
        <span>{accountCount} 个账户</span>
        {snapshotCount > 0 && <span>{snapshotCount} 个历史快照</span>}
        {assetStats.lastUpdated && <span className="tabular">资产更新 {formatCnDateTime(assetStats.lastUpdated)}</span>}
      </div>
      <MarketFreshnessLive initial={getMarketFreshness()} />
    </DashboardStatusBar>
  );
}
