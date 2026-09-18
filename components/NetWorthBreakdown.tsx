import type { NetWorthChange } from "@/lib/netWorthChange";
import { formatMoney } from "@/lib/utils";

export function signedMoney(value: number, currency: string) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatMoney(Math.abs(value), currency)}`;
}

export function ChangeAmount({ value, currency }: { value: number; currency: string }) {
  return <span className={`tabular whitespace-nowrap font-medium ${value > 0 ? "text-gain-700" : value < 0 ? "text-loss-700" : "text-ink-500"}`}>
    {signedMoney(value, currency)}
  </span>;
}

export function NetWorthBreakdown({ change, currency, compact = false }: {
  change: NetWorthChange; currency: string; compact?: boolean;
}) {
  if (change.total == null) return <p className="text-[12px] text-ink-500">首个快照，暂无对比数据。</p>;
  return (
    <div className={compact ? "space-y-2 text-[12px]" : "space-y-3 text-[12px]"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-ink-500">{change.comparison}</span>
        <ChangeAmount value={change.total} currency={currency} />
      </div>
      {!compact && <div className="tabular text-[11px] text-ink-400">{change.from} → {change.to} · 以 {currency} 计</div>}
      {change.items.length ? (
        <ul className={compact ? "space-y-1.5 border-t border-hair pt-2" : "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"}>
          {change.items.map(item => (
            <li key={item.kind} className={`flex items-center justify-between gap-4 ${compact ? "" : "rounded-md bg-canvas-sunk px-3 py-2"}`}>
              <span className={item.kind === "unclassified" ? "text-gold-700" : "text-ink-600"}>{item.label}</span>
              <ChangeAmount value={item.amount} currency={currency} />
            </li>
          ))}
        </ul>
      ) : <p className="text-ink-500">本区间各项净影响为 0。</p>}
      {change.partial && <p className="text-[11px] leading-relaxed text-gold-700">部分变化暂无法归因，已列出可确认项目；未归因金额为 0 也不代表历史记录完整。</p>}
      {!compact && <>
        <p className="text-[11px] leading-relaxed text-ink-400">
          各项合计等于净值变化。汇率按两端平均敞口计算，其余项目按两端平均汇率折算；证券价格变动为快照区间内扣除持仓资金变动后的估值变化。
        </p>
        {change.notes.length > 0 && <p className="text-[11px] leading-relaxed text-ink-400">{change.notes.join(" ")}</p>}
      </>}
    </div>
  );
}
