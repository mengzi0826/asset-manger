import { fetch as undiciFetch } from "undici";
import {
  getDB,
  getSetting,
  type FxRate,
  type FxRateHistory,
  setSetting,
  removeSetting,
  SETTING_LAST_FX_REFRESH_ERROR
} from "./db";
import { SUPPORTED_CURRENCIES } from "./currencies";
import { getJuheFxAppKey } from "./juheKeys";
import { nextFxAutoRefreshIso, nowCn, shouldRefreshFxEvery8h } from "./time";

export { SUPPORTED_CURRENCIES };
export type { Currency } from "./currencies";

const JUHE_EXCHANGE_URL = "http://op.juhe.cn/onebox/exchange/currency";
const FX_SOURCE = "juhe";

interface JuheExchangeItem {
  currencyF: string;
  currencyF_Name?: string;
  currencyT: string;
  currencyT_Name?: string;
  currencyFD?: number;
  exchange: string;
  result: string | number;
  updateTime: string;
}

interface JuheExchangeResponse {
  reason?: string;
  result?: JuheExchangeItem[] | null;
  error_code: number;
}

function nowIso() {
  return nowCn();
}

export function getRate(base: string, quote: string): number | null {
  if (base === quote) return 1;
  const db = getDB();
  const row = db
    .prepare("SELECT rate FROM fx_rate WHERE base = ? AND quote = ?")
    .get(base, quote) as { rate: number } | undefined;
  if (row) return row.rate;
  const reverse = db
    .prepare("SELECT rate FROM fx_rate WHERE base = ? AND quote = ?")
    .get(quote, base) as { rate: number } | undefined;
  if (reverse && reverse.rate !== 0) return 1 / reverse.rate;
  return null;
}

export function convert(amount: number, from: string, to: string): number | null {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  const r = getRate(from, to);
  return r == null ? null : amount * r;
}

export function listRates(): FxRate[] {
  return getDB().prepare("SELECT * FROM fx_rate ORDER BY base, quote").all() as FxRate[];
}

function saveRate(base: string, quote: string, rate: number, source: string) {
  const db = getDB();
  const observedAt = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO fx_rate (base, quote, rate, source, fetched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(base, quote) DO UPDATE SET
         rate = excluded.rate,
         source = excluded.source,
         fetched_at = excluded.fetched_at`
    ).run(base, quote, rate, source, observedAt);
    db.prepare(
      `INSERT INTO fx_rate_history (base, quote, rate, source, observed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(base, quote, observed_at) DO UPDATE SET
         rate = excluded.rate,
         source = excluded.source`
    ).run(base, quote, rate, source, observedAt);
  })();
}

export function setManualRate(base: string, quote: string, rate: number) {
  saveRate(base, quote, rate, "manual");
}

export interface ListRateHistoryOptions {
  base?: string;
  quote?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** 汇率观测历史，供报表和本地 AI 做只读分析。 */
export function listRateHistory(options: ListRateHistoryOptions = {}): FxRateHistory[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.base) {
    clauses.push("base = ?");
    params.push(options.base.toUpperCase());
  }
  if (options.quote) {
    clauses.push("quote = ?");
    params.push(options.quote.toUpperCase());
  }
  if (options.from) {
    clauses.push("observed_at >= ?");
    params.push(options.from);
  }
  if (options.to) {
    clauses.push("observed_at <= ?");
    params.push(options.to);
  }
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 1000), 10000));
  params.push(limit);
  return getDB()
    .prepare(
      `SELECT * FROM fx_rate_history
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY observed_at DESC, base, quote
       LIMIT ?`
    )
    .all(...params) as FxRateHistory[];
}

/** 查询某时点以前最后一次观测汇率；没有正向值时尝试反向值。 */
export function getHistoricalRateAtOrBefore(
  base: string,
  quote: string,
  at: string
): number | null {
  base = base.toUpperCase();
  quote = quote.toUpperCase();
  if (base === quote) return 1;
  const db = getDB();
  const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T23:59:59+08:00` : at;
  const find = (from: string, to: string) =>
    db
      .prepare(
        `SELECT rate FROM fx_rate_history
         WHERE base = ? AND quote = ? AND observed_at <= ?
         ORDER BY observed_at DESC
         LIMIT 1`
      )
      .get(from, to, cutoff) as { rate: number } | undefined;
  const direct = find(base, quote);
  if (direct) return direct.rate;
  const reverse = find(quote, base);
  return reverse && reverse.rate !== 0 ? 1 / reverse.rate : null;
}

type JuheFetchResult =
  | { ok: true; items: JuheExchangeItem[] }
  | { ok: false; fatal: boolean; error: string };

const JUHE_FX_MAX_ATTEMPTS = 3;
const JUHE_FX_RETRY_DELAY_MS = 1000;

async function fetchPairFromJuheOnce(
  appkey: string,
  from: string,
  to: string
): Promise<JuheFetchResult> {
  const url = `${JUHE_EXCHANGE_URL}?key=${encodeURIComponent(
    appkey
  )}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&version=2`;
  try {
    const res = await undiciFetch(url, {
      headers: { "user-agent": "asset-manager/1.0 (+node)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return { ok: false, fatal: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as JuheExchangeResponse;
    if (data.error_code === 0 && Array.isArray(data.result)) {
      return { ok: true, items: data.result };
    }
    const reason = data.reason ?? `error_code=${data.error_code}`;
    const fatal = isFatalJuheError(data.error_code);
    return { ok: false, fatal, error: reason };
  } catch (e: any) {
    const cause = e?.cause;
    const detail = [e?.message, cause?.code, cause?.message]
      .filter(Boolean)
      .join(" | ");
    return { ok: false, fatal: false, error: detail || "network error" };
  }
}

async function fetchPairFromJuhe(
  appkey: string,
  from: string,
  to: string
): Promise<JuheFetchResult> {
  let last: JuheFetchResult = { ok: false, fatal: false, error: "unknown" };
  for (let attempt = 1; attempt <= JUHE_FX_MAX_ATTEMPTS; attempt++) {
    last = await fetchPairFromJuheOnce(appkey, from, to);
    if (last.ok || last.fatal) return last;
    if (attempt < JUHE_FX_MAX_ATTEMPTS) {
      console.warn(
        `[fx] ${from}->${to} attempt ${attempt} failed (${last.error}), retrying...`
      );
      await new Promise((r) => setTimeout(r, JUHE_FX_RETRY_DELAY_MS));
    }
  }
  return last;
}

function isFatalJuheError(code: number): boolean {
  // 10001 错误KEY, 10002 无权限, 10003 KEY过期, 10009 禁止KEY,
  // 10012 超次数限制, 10021 接口停用 等系统级错误无需继续轮询其他币对
  return [10001, 10002, 10003, 10004, 10005, 10007, 10008, 10009, 10011, 10012, 10021].includes(
    code
  );
}

export interface RefreshRatesResult {
  updated: boolean;
  error?: string;
  skipped?: "not_due" | "no_key";
  last_refreshed_at: string | null;
  next_refresh_at: string;
}

export function getLastFxRefreshAt(): string | null {
  const db = getDB();
  const row = db
    .prepare("SELECT MAX(fetched_at) AS t FROM fx_rate WHERE source != 'manual'")
    .get() as { t: string | null };
  return row?.t ?? null;
}

export function getLastFxRefreshError(): string | null {
  const v = getSetting(SETTING_LAST_FX_REFRESH_ERROR)?.trim();
  return v || null;
}

export async function refreshRates(force = false): Promise<RefreshRatesResult> {
  const last = getLastFxRefreshAt();
  const next_refresh_at = nextFxAutoRefreshIso(last);
  const appkey = getJuheFxAppKey();
  if (!appkey) {
    return {
      updated: false,
      skipped: "no_key",
      error: "请先在「设置」中配置汇率 AppKey，或使用环境变量 JUHE_FX_APPKEY",
      last_refreshed_at: last,
      next_refresh_at
    };
  }
  if (!force && !shouldRefreshFxEvery8h(last)) {
    return {
      updated: false,
      skipped: "not_due",
      last_refreshed_at: last,
      next_refresh_at
    };
  }

  // 聚合数据「全球汇率查询换算」每次返回一组 from↔to 双向汇率，
  // 故对 N 个币种只需要 N*(N-1)/2 次请求即可覆盖所有币对。
  const codes = [...SUPPORTED_CURRENCIES];
  let anySuccess = false;
  let lastErr: string | undefined;

  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const from = codes[i];
      const to = codes[j];
      const r = await fetchPairFromJuhe(appkey, from, to);
      if (!r.ok) {
        lastErr = r.error;
        if (r.fatal) {
          const error = `汇率接口调用失败：${r.error}`;
          setSetting(SETTING_LAST_FX_REFRESH_ERROR, error);
          return {
            updated: anySuccess,
            error,
            last_refreshed_at: getLastFxRefreshAt(),
            next_refresh_at
          };
        }
        continue;
      }
      for (const item of r.items) {
        const rate = Number(item.exchange);
        if (!Number.isFinite(rate) || rate <= 0) continue;
        const base = (item.currencyF || "").toUpperCase();
        const quote = (item.currencyT || "").toUpperCase();
        if (!base || !quote) continue;
        saveRate(base, quote, rate, FX_SOURCE);
      }
      anySuccess = true;
    }
  }

  if (!anySuccess) {
    const error = lastErr
      ? `无法连接汇率服务（${lastErr}）`
      : "无法连接汇率服务";
    setSetting(SETTING_LAST_FX_REFRESH_ERROR, error);
    return {
      updated: false,
      error,
      last_refreshed_at: getLastFxRefreshAt(),
      next_refresh_at
    };
  }
  removeSetting(SETTING_LAST_FX_REFRESH_ERROR);
  // 汇率变化本身会改变基准币净值；刷新成功后立即重写当天逐资产估值。
  // 动态导入避免 history.ts -> fx.ts 的静态循环依赖。
  try {
    const { recordSnapshot } = await import("./history");
    recordSnapshot((getSetting("base_currency") ?? "CNY").toUpperCase());
  } catch (e: any) {
    console.warn("[fx] valuation snapshot after refresh failed:", e?.message ?? e);
  }
  return {
    updated: true,
    last_refreshed_at: getLastFxRefreshAt(),
    next_refresh_at
  };
}

export async function ensureRates() {
  await refreshRates(false).catch(() => {});
}

/**
 * 非阻塞版：触发后台刷新但立即返回，不阻塞 SSR 首屏。
 * 失败会吞掉，仅打印日志。
 */
export function kickoffRatesRefresh(): void {
  refreshRates(false).catch((e) => {
    console.warn("[fx] background refresh failed:", e?.message ?? e);
  });
}
