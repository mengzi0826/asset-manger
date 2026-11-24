import { PageHeader } from "@/components/PageHeader";
import { getSetting } from "@/lib/db";
import { kickoffRatesRefresh } from "@/lib/fx";
import { ensureTodaySnapshot, listChangesPage, listSnapshots } from "@/lib/history";
import { HistoryChart } from "@/components/charts/HistoryChart";
import { buildNetWorthHistory } from "@/lib/netWorthHistory";
import { formatDate, formatMoney, formatPercent } from "@/lib/utils";
import { accrueTodayInterest } from "@/lib/interest";
import { parseChangeLogFilters, type HistorySearchParams } from "@/lib/changeLog";
import { RecordSnapshotButton } from "./_components/RecordSnapshotButton";
import { ChangeLog } from "./_components/ChangeLog";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams = {} }: { searchParams?: HistorySearchParams }) {
  kickoffRatesRefresh();
  accrueTodayInterest();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  ensureTodaySnapshot(baseCurrency);
  const snapshots = listSnapshots(baseCurrency, 3650);
  const historyPoints = buildNetWorthHistory(snapshots);
  const filters = parseChangeLogFilters(searchParams);
  const changes = listChangesPage(filters);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) query.append(key, item);
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const totalChange = first && last ? last.total_value - first.total_value : 0;
  const totalChangePct =
    first && last && first.total_value ? totalChange / first.total_value : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="历史" actions={<RecordSnapshotButton />} />

      {/* Summary strip */}
      {first && last && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCell label="起始" value={formatMoney(first.total_value, baseCurrency)} hint={formatDate(first.date)} />
          <SummaryCell label="当前" value={formatMoney(last.total_value, baseCurrency)} hint={formatDate(last.date)} />
          <SummaryCell
            label="累计变化"
            value={`${totalChange >= 0 ? "+" : ""}${formatMoney(totalChange, baseCurrency)}`}
            hint={`${totalChange >= 0 ? "+" : ""}${formatPercent(totalChangePct)}`}
            tone={totalChange >= 0 ? "gain" : "loss"}
          />
          <SummaryCell label="快照数" value={String(snapshots.length)} hint="个历史数据点" />
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <div className="card-title">净值走势</div>
            <span className="chip tabular">以 {baseCurrency} 结算</span>
          </div>
        </div>
        <div className="card-body">
          <HistoryChart data={historyPoints} currency={baseCurrency} />
        </div>
      </div>

      <ChangeLog filters={filters} result={changes} query={query.toString()} />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "gain" | "loss";
}) {
  const color =
    tone === "gain" ? "text-gain-700" : tone === "loss" ? "text-loss-700" : "text-ink-900";
  return (
    <div className="card">
      <div className="p-4">
        <div className="eyebrow">{label}</div>
        <div className={`tabular mt-1.5 text-[20px] font-semibold ${color}`}>{value}</div>
        {hint && <div className="tabular mt-1 text-[12px] text-ink-400">{hint}</div>}
      </div>
    </div>
  );
}
