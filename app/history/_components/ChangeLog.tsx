import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { AssetChange } from "@/lib/db";
import {
  CHANGE_LOG_PAGE_SIZE,
  CHANGE_LOG_TYPES,
  changeLogHref,
  getChangeLogType,
  parseChangeFields,
  parseChangeObject,
  type ChangeFields,
  type ChangeLogFilters as Filters
} from "@/lib/changeLog";
import type { ChangeLogPage } from "@/lib/history";
import { formatCnDate, formatCnDateTime, formatDate, formatMoney } from "@/lib/utils";
import { ChangeLogFilters } from "./ChangeLogFilters";

const FIELD_LABELS: Record<string, string> = {
  account_id: "账户",
  symbol: "证券代码",
  name: "名称",
  currency: "货币",
  quantity: "份额",
  unit_cost: "买入均价",
  dividend_amount: "本次分红到账",
  cash_flow_type: "现金操作",
  cash_flow_amount: "现金流金额",
  cash_flow_reason: "现金流原因",
  cash_flow_reversed_at: "已撤回时间",
  cash_flow_undo: "撤回收支",
  security_trade_undo: "撤回证券交易",
  interest_annual_rate: "年化利率",
  interest_principal: "计息本金",
  current_price: "当前价",
  amount: "金额",
  annual_rate: "年化",
  start_date: "起息日",
  maturity_date: "到期日",
  notes: "备注"
};

export function ChangeLog({ filters, result, query }: { filters: Filters; result: ChangeLogPage; query: string }) {
  const { changes, total, page, pageCount } = result;
  const groups = new Map<string, AssetChange[]>();
  for (const change of changes) {
    const date = formatCnDate(change.created_at);
    const group = groups.get(date) ?? [];
    group.push(change);
    groups.set(date, group);
  }

  return (
    <section className="card scroll-mt-24" id="change-log" aria-labelledby="change-log-title">
      <div className="card-header">
        <h2 className="card-title" id="change-log-title">变动日志</h2>
        <span className="chip tabular">共 {total} 条</span>
      </div>
      <div className="card-body">
        <ChangeLogFilters key={JSON.stringify(filters)} filters={filters} />
        {changes.length === 0 ? (
          <div className="py-12 text-center text-[14px] text-ink-400">
            {filters.error ? "日期范围无效，暂未查询日志" : "当前筛选条件下暂无变动记录"}
          </div>
        ) : (
          <div className="space-y-5 pt-5">
            {[...groups].map(([date, entries]) => (
              <section key={date} aria-label={`${date}的变动记录`}>
                <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink-600">
                  <span className="tabular">{date}</span>
                  <span className="text-[12px] font-normal text-ink-400">本页 {entries.length} 条</span>
                </h3>
                <ul className="history-log ml-1 mt-1">
                  {entries.map(change => <ChangeLogEntry key={change.id} change={change} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
        {!filters.error && (
          <nav className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-4" aria-label="变动日志分页">
            <p className="tabular text-[12px] text-ink-400">
              {total > 0 ? `第 ${(page - 1) * CHANGE_LOG_PAGE_SIZE + 1}–${(page - 1) * CHANGE_LOG_PAGE_SIZE + changes.length} 条，共 ${total} 条` : "共 0 条"}
              <span className="ml-2">每页 {CHANGE_LOG_PAGE_SIZE} 条</span>
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link className="btn-outline px-3" href={changeLogHref(filters, page - 1, query)}>
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />上一页
                </Link>
              ) : (
                <button className="btn-outline px-3" disabled><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />上一页</button>
              )}
              <span className="tabular px-1 text-[13px] text-ink-500" aria-current="page">{page} / {pageCount}</span>
              {page < pageCount ? (
                <Link className="btn-outline px-3" href={changeLogHref(filters, page + 1, query)}>
                  下一页<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : (
                <button className="btn-outline px-3" disabled>下一页<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
              )}
            </div>
          </nav>
        )}
      </div>
    </section>
  );
}

function ChangeLogEntry({ change }: { change: AssetChange }) {
  const fields = parseChangeFields(change.field_changes);
  const snapshot = parseChangeObject(change.snapshot);
  const type = getChangeLogType(change);
  const label = CHANGE_LOG_TYPES.find(item => item.value === type)?.label;
  const tone = type === "create" || type === "deposit" || type === "interest" || type === "dividend"
    ? "chip-gain" : type === "delete" || type === "expense" ? "chip-loss" : "chip-info";
  const snapshotFields = Object.entries(snapshot).filter(([field, value]) => field in FIELD_LABELS && value != null && value !== "");

  return (
    <li>
      <details className="group">
        <summary className="cursor-pointer list-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <span className={`chip ${tone}`}>{label}</span>
            <span className="min-w-0 break-words font-medium text-ink-900">{change.asset_name ?? `#${change.asset_id ?? "-"}`}</span>
            <span className="tabular text-[12px] text-ink-400">{formatCnDateTime(change.created_at)}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] text-ink-400">
              <span className="group-open:hidden">展开详情</span>
              <span className="hidden group-open:inline">收起详情</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-2 truncate pr-2 text-[13px] text-ink-500">{summarizeChange(change, fields, snapshot)}</p>
        </summary>
        <div className="mt-3 rounded-lg border border-hair bg-canvas-sunk/40 p-3">
          {change.action === "update" && Object.keys(fields).length > 0 ? (
            <table className="w-full table-fixed text-left text-[12px] sm:text-[13px]">
              <caption className="sr-only">{change.asset_name ?? "资产"}的字段修改详情</caption>
              <thead className="text-[12px] font-normal text-ink-400">
                <tr><th className="w-1/4 pb-2 font-normal">字段</th><th className="pb-2 font-normal">修改前</th><th className="pb-2 font-normal">修改后</th></tr>
              </thead>
              <tbody>
                {Object.entries(fields).map(([field, diff]) => (
                  <tr key={field} className="align-top">
                    <th scope="row" className="break-words py-1.5 pr-2 font-normal text-ink-500">{FIELD_LABELS[field] ?? field}</th>
                    <td className="tabular whitespace-pre-wrap break-words py-1.5 pr-3 text-ink-400">{renderValue(diff.from, field)}</td>
                    <td className="tabular whitespace-pre-wrap break-words py-1.5 text-ink-800">{renderValue(diff.to, field)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : change.action !== "update" && snapshotFields.length > 0 ? (
            <>
              <p className="mb-2 text-[12px] text-ink-400">{change.action === "delete" ? "删除前的资产信息" : "新增时的资产信息"}</p>
              <dl className="grid grid-cols-[minmax(70px,1fr)_3fr] gap-x-3 gap-y-2 text-[13px]">
                {snapshotFields.map(([field, value]) => (
                  <div className="contents" key={field}>
                    <dt className="text-ink-400">{FIELD_LABELS[field]}</dt>
                    <dd className="tabular min-w-0 whitespace-pre-wrap break-words text-ink-700">{renderValue(value, field)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : <p className="text-[13px] text-ink-400">这条历史记录未保存字段详情。</p>}
          {change.base_value_cny != null && (
            <p className="tabular mt-3 border-t border-hair pt-2 text-[12px] text-ink-400">
              {change.action === "delete" ? "删除前" : "变动后"}资产估值 ≈ {formatMoney(change.base_value_cny, "CNY")}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

function summarizeChange(change: AssetChange, fields: ChangeFields, snapshot: Record<string, unknown>) {
  const type = getChangeLogType(change);
  const currency = typeof snapshot.currency === "string" ? snapshot.currency : undefined;
  if (typeof fields.security_trade_undo?.to === "string") return fields.security_trade_undo.to;
  if (typeof fields.cash_flow_undo?.to === "string") return fields.cash_flow_undo.to;
  const cashAmount = fields.cash_flow_amount?.to;
  if ((type === "deposit" || type === "expense" || type === "interest") && typeof cashAmount === "number") {
    const amount = currency ? formatMoney(Math.abs(cashAmount), currency) : renderValue(Math.abs(cashAmount), "amount");
    return `${fields.cash_flow_reversed_at?.to ? "已撤回 · " : ""}${type === "expense" ? "支出" : "入账"} ${amount}${fields.cash_flow_reason?.to ? ` · ${String(fields.cash_flow_reason.to)}` : ""}`;
  }
  if (type === "dividend" && typeof fields.dividend_amount?.to === "number") {
    return `分红到账 ${currency ? formatMoney(fields.dividend_amount.to, currency) : renderValue(fields.dividend_amount.to, "amount")}`;
  }
  const entries = Object.entries(fields);
  if (change.action === "update" && entries.length > 0) {
    const summary = entries.slice(0, 2).map(([field, diff]) => `${FIELD_LABELS[field] ?? field} ${renderValue(diff.from, field)} → ${renderValue(diff.to, field)}`).join(" · ");
    return entries.length > 2 ? `${summary} 等 ${entries.length} 项修改` : summary;
  }
  if (typeof snapshot.amount === "number" && snapshot.amount > 0) {
    return `金额 ${currency ? formatMoney(snapshot.amount, currency) : renderValue(snapshot.amount, "amount")}`;
  }
  if (snapshot.quantity != null) return `份额 ${renderValue(snapshot.quantity, "quantity")} · 买入均价 ${renderValue(snapshot.unit_cost, "unit_cost")}`;
  return change.action === "create" ? "新增资产" : change.action === "delete" ? "删除资产" : "修改资产信息";
}

function renderValue(value: unknown, field: string): string {
  if (value == null || value === "") return "—";
  if (field === "start_date" || field === "maturity_date") return formatDate(String(value));
  if (field === "cash_flow_type") return value === "deposit" ? "入金" : value === "expense" ? "消费" : value === "interest" ? "利息收入" : String(value);
  if ((field === "interest_annual_rate" || field === "annual_rate") && typeof value === "number") return `${(value * 100).toFixed(2)}%`;
  if (typeof value === "number") return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
