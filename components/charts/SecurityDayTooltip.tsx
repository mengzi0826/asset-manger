import type { SecurityDayDetail } from "@/lib/securityDayDetails";
import { formatMoney } from "@/lib/utils";

export function SecurityDayTooltip({ date, value, metric, currency, day }: {
  date: string;
  value?: number;
  metric: string;
  currency: string;
  day?: SecurityDayDetail;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const signed = (n: number) => <span className={n > 0 ? "text-gain-700" : n < 0 ? "text-loss-700" : ""}>
    {n > 0 ? "+" : ""}{money(n)}
  </span>;
  return (
    <div className="max-w-[min(85vw,23rem)] rounded-lg border border-hair bg-canvas-raised px-3 py-2 text-xs text-ink-800 shadow-card">
      <div className="mb-1 text-ink-500">{date}</div>
      <div className="flex justify-between gap-5 font-semibold">
        <span>{metric}</span><span>{value == null ? "—" : money(value)}</span>
      </div>
      {metric === "证券市值" ? <>
        <div className="mt-2 border-t border-hair pt-2 font-semibold">当日操作</div>
        {day?.operations.map((line, i) => <div key={i}>{line}</div>)}
        {!day?.operationsCovered ? <div className="text-ink-500">交易记录覆盖不完整</div> :
          !day.operations.length && <div className="text-ink-500">无已记录操作</div>}
        <div className="mt-2 font-semibold">市场当日盈亏</div>
        {(["hs", "hk", "us"] as const).map((market, i) => {
          const pnl = day?.session?.markets[market];
          return <div key={market} className="flex justify-between gap-5">
            <span>{["沪深", "港股", "美股"][i]}{market === "us" && day?.session?.usDate && ` · ${day.session.usDate}`}</span>{pnl == null ? "—" : signed(pnl)}
          </div>;
        })}
      </> : <>
        {(["winners", "losers"] as const).map(key => (
          <div key={key} className="mt-2 border-t border-hair pt-2">
            <div className="font-semibold">当日{key === "winners" ? "盈利" : "亏损"} Top 3</div>
            {day?.session?.[key].map((row, i) => <div key={i} className="flex justify-between gap-5">
              <span>{row.name}</span>{signed(row.pnl)}
            </div>)}
            {!day?.session?.[key].length && <div className="text-ink-500">
              {day?.session && Object.keys(day.session.markets).length ? "无已记录标的" : "暂无可核实数据"}
            </div>}
          </div>
        ))}
        {day?.session?.usDate && <div className="mt-1 text-ink-500">美股交易日 {day.session.usDate}</div>}
      </>}
      {day?.session?.partial && <div className="mt-1 text-ink-500">盈亏数据仅部分覆盖</div>}
    </div>
  );
}
