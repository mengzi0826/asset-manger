import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { getDB, type FxRate } from "./db";
import { SUPPORTED_CURRENCIES } from "./currencies";
import { getJuheFxAppKey } from "./juheKeys";
import { nextFxAutoRefreshIso, nowCn, parseDbDate, shouldRefreshFxEvery8h } from "./time";

export { SUPPORTED_CURRENCIES };
export type { Currency } from "./currencies";

const JUHE_EXCHANGE_URL = "http://op.juhe.cn/onebox/exchange/currency";
const FX_SOURCE = "juhe";

// 很多开发环境本机开了 Clash / ClashX / Surge 等代理（Fake-IP 模式），
// Node 原生 fetch 默认不走系统代理，会出现 DNS 解析失败 / 连接被拒。
// 这里显式读取 HTTP(S)_PROXY / ALL_PROXY 环境变量，只针对汇率调用走代理，
// 不影响 Next.js 其他 fetch 行为。
let fxDispatcher: Dispatcher | undefined;
let fxDispatcherInitialized = false;

function getFxDispatcher(): Dispatcher | undefined {
  if (fxDispatcherInitialized) return fxDispatcher;
  fxDispatcherInitialized = true;
  const proxy =
    process.env.FX_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (proxy) {
    try {
      fxDispatcher = new ProxyAgent(proxy);
      console.log(`[fx] using HTTP proxy for juhe: ${proxy}`);
    } catch (e: any) {
      console.warn(`[fx] invalid proxy url "${proxy}": ${e?.message}`);
    }
  }
  return fxDispatcher;
}

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

export function setManualRate(base: string, quote: string, rate: number) {
  const db = getDB();
  db.prepare(
    `INSERT INTO fx_rate (base, quote, rate, source, fetched_at)
     VALUES (?, ?, ?, 'manual', ?)
     ON CONFLICT(base, quote) DO UPDATE SET rate = excluded.rate, source = 'manual', fetched_at = excluded.fetched_at`
  ).run(base, quote, rate, nowIso());
}

type JuheFetchResult =
  | { ok: true; items: JuheExchangeItem[] }
  | { ok: false; fatal: boolean; error: string };

async function fetchPairFromJuhe(
  appkey: string,
  from: string,
  to: string
): Promise<JuheFetchResult> {
  const url = `${JUHE_EXCHANGE_URL}?key=${encodeURIComponent(
    appkey
  )}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&version=2`;
  try {
    const dispatcher = getFxDispatcher();
    const res = await undiciFetch(url, {
      dispatcher,
      headers: { "user-agent": "asset-manager/1.0 (+node)" }
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
    console.error(`[fx] juhe fetch failed (${from}->${to}):`, detail, e);
    return { ok: false, fatal: false, error: detail || "network error" };
  }
}

function isFatalJuheError(code: number): boolean {
  // 10001 错误KEY, 10002 无权限, 10003 KEY过期, 10009 禁止KEY,
  // 10012 超次数限制, 10021 接口停用 等系统级错误无需继续轮询其他币对
  return [10001, 10002, 10003, 10004, 10005, 10007, 10008, 10009, 10011, 10012, 10021].includes(
    code
  );
}

function upsertRate(base: string, quote: string, rate: number, source: string) {
  const db = getDB();
  db.prepare(
    `INSERT INTO fx_rate (base, quote, rate, source, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(base, quote) DO UPDATE SET
       rate = excluded.rate,
       source = excluded.source,
       fetched_at = excluded.fetched_at`
  ).run(base, quote, rate, source, nowIso());
}

function lastFetchedAt(): number {
  const db = getDB();
  const row = db
    .prepare("SELECT MAX(fetched_at) AS t FROM fx_rate WHERE source != 'manual'")
    .get() as { t: string | null };
  if (!row?.t) return 0;
  return parseDbDate(row.t).getTime();
}

export interface RefreshRatesResult {
  updated: boolean;
  error?: string;
  skipped?: "not_due" | "no_key";
  last_refreshed_at: string | null;
  next_refresh_at: string;
}

function lastRefreshedIso(): string | null {
  const db = getDB();
  const row = db
    .prepare("SELECT MAX(fetched_at) AS t FROM fx_rate WHERE source != 'manual'")
    .get() as { t: string | null };
  return row?.t ?? null;
}

export async function refreshRates(force = false): Promise<RefreshRatesResult> {
  const last = lastRefreshedIso();
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
          return {
            updated: anySuccess,
            error: `汇率接口调用失败：${r.error}`,
            last_refreshed_at: lastRefreshedIso(),
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
        upsertRate(base, quote, rate, FX_SOURCE);
      }
      anySuccess = true;
    }
  }

  if (!anySuccess) {
    return {
      updated: false,
      error: lastErr
        ? `无法连接汇率服务（${lastErr}），已回落至缓存值`
        : "无法连接汇率服务，已回落至缓存值",
      last_refreshed_at: lastRefreshedIso(),
      next_refresh_at
    };
  }
  return {
    updated: true,
    last_refreshed_at: lastRefreshedIso(),
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
