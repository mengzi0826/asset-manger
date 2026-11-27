import { UndoSecurityTrade } from "./UndoSecurityTrade";
import { lastSecuritySubmission } from "@/lib/securityTradeUndo";
import { formatCnDate, formatMoney } from "@/lib/utils";

import type { ClosedPosition } from "@/lib/securityLifetimeProfit";

export function ClosedPositions({ rows }: { rows: ClosedPosition[] }) {
  if (!rows.length) {
    return <p className="card-body text-sm text-ink-500">暂无已记录的清仓交易。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-ink-500">
          <tr>
            <th className="px-4 py-3">证券</th>
            <th className="px-4 py-3">清仓日期</th>
            <th className="px-4 py-3 text-right">清仓盈亏（原币）</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ eventId, assetId, name, closedAt, profit, currency }) => {
            const target = assetId == null ? null : lastSecuritySubmission(assetId);
            return (
              <tr key={eventId} className="border-t border-ink-100">
                <td className="px-4 py-3 font-medium">{name}</td>
                <td className="whitespace-nowrap px-4 py-3">{formatCnDate(closedAt)}</td>
                <td className={`whitespace-nowrap px-4 py-3 text-right tabular ${profit == null || profit === 0 ? "text-ink-500" : profit > 0 ? "text-gain-700" : "text-loss-700"}`}>
                  {profit == null ? "资料不足" : `${profit > 0 ? "+" : ""}${formatMoney(profit, currency)} ${currency}`}
                </td>
                <td className="px-4 py-3 text-right">
                  {assetId != null && target?.id === eventId && <UndoSecurityTrade assetId={assetId} name={name} target={target} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
