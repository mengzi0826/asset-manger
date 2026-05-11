import { getSetting } from "@/lib/db";
import { kickoffRatesRefresh } from "@/lib/fx";
import { ensureTodaySnapshot, listChanges, listSnapshots } from "@/lib/history";
import { HistoryChart } from "@/components/charts/HistoryChart";
import { formatDate, formatMoney, formatPercent, formatCnDateTime } from "@/lib/utils";
import { RecordSnapshotButton } from "./_components/RecordSnapshotButton";

export const dynamic = "force-dynamic";

const FIELD_LABELS: Record<string, string> = {
  name: "名称",
  currency: "货币",
  quantity: "份额",
  unit_cost: "买入均价",
  current_price: "当前价",
  amount: "金额",
  annual_rate: "年化",
  start_date: "起息日",
  maturity_date: "到期日",
  notes: "备注"
};

export default async function HistoryPage() {
  kickoffRatesRefresh();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  ensureTodaySnapshot(baseCurrency);
  const snapshots = listSnapshots(baseCurrency, 3650);
  const changes = listChanges(500);

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const totalChange = first && last ? last.total_value - first.total_value : 0;
  const totalChangePct =
    first && last && first.total_value ? totalChange / first.total_value : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">历史轨迹</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900">
            历史轨迹
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            资产总值快照曲线 + 每一次增删改的字段级明细
          </p>
        </div>
        <RecordSnapshotButton />
      </div>

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
          <HistoryChart data={snapshots} currency={baseCurrency} />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">变动日志</div>
          <span className="chip tabular">{changes.length} 条</span>
        </div>
        <div className="card-body">
          {changes.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-ink-400">暂无变动记录</div>
          ) : (
            <ul className="divide-y divide-hair">
              {changes.map((c) => {
                const fieldChanges: Record<string, { from: unknown; to: unknown }> = c.field_changes
                  ? JSON.parse(c.field_changes)
                  : {};
                return (
                  <li key={c.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
                      <span
                        className={`chip ${
                          c.action === "create"
                            ? "chip-gain"
                            : c.action === "delete"
                              ? "chip-loss"
                              : "chip-info"
                        }`}
                      >
                        {c.action === "create" ? "新增" : c.action === "delete" ? "删除" : "修改"}
                      </span>
                      <span className="font-medium text-ink-900">
                        {c.asset_name ?? `#${c.asset_id ?? "-"}`}
                      </span>
                      <span className="tabular text-[11px] text-ink-400">
                        {formatCnDateTime(c.created_at)}
                      </span>
                      {c.base_value_cny != null && (
                        <span className="tabular ml-auto text-[12px] text-ink-500">
                          ≈ {formatMoney(c.base_value_cny, "CNY")}
                        </span>
                      )}
                    </div>
                    {c.action === "update" && Object.keys(fieldChanges).length > 0 && (
                      <ul className="mt-2 space-y-1 rounded-md bg-canvas-sunk/60 p-2.5 text-[12px] text-ink-600">
                        {Object.entries(fieldChanges).map(([field, diff]) => (
                          <li key={field} className="flex flex-wrap items-center gap-1.5">
                            <span className="min-w-[70px] text-ink-400">
                              {FIELD_LABELS[field] ?? field}
                            </span>
                            <span className="tabular rounded border border-loss-100 bg-loss-50 px-1.5 py-0.5 text-loss-700 line-through">
                              {renderValue(diff.from, field)}
                            </span>
                            <span className="text-ink-300">→</span>
                            <span className="tabular rounded border border-gain-100 bg-gain-50 px-1.5 py-0.5 text-gain-700">
                              {renderValue(diff.to, field)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
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
        {hint && <div className="tabular mt-1 text-[11px] text-ink-400">{hint}</div>}
      </div>
    </div>
  );
}

function renderValue(v: unknown, field: string): string {
  if (v == null || v === "") return "—";
  if (field === "start_date" || field === "maturity_date") return formatDate(String(v));
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(v);
}
