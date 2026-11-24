import type { AssetChange } from "./db";
import { isCalendarDate } from "./analysisPeriod";
import { toCnIso, todayCn } from "./time";

export const CHANGE_LOG_PAGE_SIZE = 20;
export const CHANGE_LOG_RANGES = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "month", label: "本月" },
  { value: "last-month", label: "上月" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" }
] as const;
export const CHANGE_LOG_TYPES = [
  { value: "all", label: "全部类型" },
  { value: "create", label: "新增" },
  { value: "update", label: "修改" },
  { value: "delete", label: "删除" },
  { value: "deposit", label: "入金" },
  { value: "expense", label: "消费" },
  { value: "interest", label: "利息收入" },
  { value: "dividend", label: "分红" }
] as const;

export type ChangeLogRange = (typeof CHANGE_LOG_RANGES)[number]["value"];
export type ChangeLogType = (typeof CHANGE_LOG_TYPES)[number]["value"];
export interface ChangeLogFilters {
  range: ChangeLogRange;
  type: ChangeLogType;
  from?: string;
  to?: string;
  page: number;
  error?: string;
}
export type ChangeFields = Record<string, { from?: unknown; to?: unknown }>;
export type HistorySearchParams = Record<string, string | string[] | undefined>;

const DAY_MS = 86400000;

export function parseChangeLogFilters(params: HistorySearchParams = {}, today = todayCn()): ChangeLogFilters {
  const first = (key: string) => Array.isArray(params[key]) ? params[key][0] : params[key];
  const range = CHANGE_LOG_RANGES.find(item => item.value === first("logRange"))?.value ?? "30d";
  const type = CHANGE_LOG_TYPES.find(item => item.value === first("logType"))?.value ?? "all";
  const pageNumber = Number(first("logPage") ?? 1);
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  const filters: ChangeLogFilters = { range, type, page };
  if (range === "all") return filters;
  if (range === "custom") {
    const from = first("logFrom") ?? "";
    const to = first("logTo") ?? "";
    filters.from = isCalendarDate(from) ? from : undefined;
    filters.to = isCalendarDate(to) ? to : undefined;
    if (!filters.from || !filters.to || filters.from > filters.to) {
      filters.error = "请选择有效的起止日期，开始日期不能晚于结束日期。";
    }
    return filters;
  }
  filters.to = today;
  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    filters.from = toCnIso(new Date(Date.parse(`${today}T00:00:00+08:00`) - (days - 1) * DAY_MS)).slice(0, 10);
  } else if (range === "month") {
    filters.from = `${today.slice(0, 7)}-01`;
  } else {
    filters.to = toCnIso(new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00+08:00`) - DAY_MS)).slice(0, 10);
    filters.from = `${filters.to.slice(0, 7)}-01`;
  }
  return filters;
}

/** 日志参数单独命名，翻页和筛选均保留页面上其它区域的参数。 */
export function changeLogHref(filters: ChangeLogFilters, page = 1, currentQuery = "") {
  const params = new URLSearchParams(currentQuery);
  for (const key of ["logRange", "logType", "logFrom", "logTo", "logPage"]) params.delete(key);
  params.set("logRange", filters.range);
  if (filters.type !== "all") params.set("logType", filters.type);
  if (filters.range === "custom") {
    if (filters.from) params.set("logFrom", filters.from);
    if (filters.to) params.set("logTo", filters.to);
  }
  if (page > 1) params.set("logPage", String(page));
  return `/history?${params.toString()}#change-log`;
}

export function parseChangeObject(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseChangeFields(raw: string | null): ChangeFields {
  return Object.fromEntries(Object.entries(parseChangeObject(raw)).filter(([, diff]) =>
    diff && typeof diff === "object" && !Array.isArray(diff) && ("from" in diff || "to" in diff)
  )) as ChangeFields;
}

/** 只识别日志自身的明确标记，不从份额增减推断买卖，也不关联旧业务记录。 */
export function getChangeLogType(change: Pick<AssetChange, "action" | "field_changes">): Exclude<ChangeLogType, "all"> {
  if (change.action !== "update") return change.action;
  const fields = parseChangeFields(change.field_changes);
  const flow = fields.cash_flow_type?.to;
  if (flow === "deposit" || flow === "expense" || flow === "interest") return flow;
  if (typeof fields.dividend_amount?.to === "number") return "dividend";
  return "update";
}
