import { fetch as undiciFetch } from "undici";
import {
  getDB,
  getSetting,
  removeSetting,
  setSetting,
  SETTING_LAST_STOCKS_REFRESH_ERROR,
  type AssetWithMeta
} from "./db";
import { recordSnapshot } from "./history";
import {
  isAnyStockMarketOpen,
  nextStockAutoRefreshIso,
  nowCn,
  nowCnMinute,
  parseDbDate,
  parseTencentQuoteTimeToSessionYmd,
  shouldRefreshStocks,
  toCnIso
} from "./time";

/**
 * 腾讯财经公开行情 `https://qt.gtimg.cn/q=`。一次请求用逗号拼上全部持仓，不需要 AppKey。
 * 代码：沪深 `sh600519` / `sz000001`，港股 `hk00700`，美股 `usAAPL`。
 * 返回 GBK，`~` 分隔。现价 `[3]`，行情时间 `[30]`，涨跌额 `[31]`，涨跌幅 `[32]`（百分数，入库除以 100）。
 * 自动刷新在任一市场开市期间每 15 分钟一批；休市不打接口。手动 `force` 随时拉。
 * `change_quote_date` 取时间字段上的日历日：沪深/港股是北京/香港日期，美股是美东交易日。解析不到写 null。
 */

const TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q=";

export type StockMarket = "hs" | "hk" | "us";

export interface StockSymbolInfo {
  market: StockMarket;
  /** 调接口时传入的参数值（沪深/美股用 gid，港股用 num） */
  apiParam: string;
  /** 规范化后的内部显示符号：SH600519 / HK00700 / AAPL */
  display: string;
  /** 人类可读的市场名 */
  marketName: string;
}

export const MARKET_NAME: Record<StockMarket, string> = {
  hs: "沪深 A 股",
  hk: "港股",
  us: "美股"
};

/**
 * 6 位数字证券代码 → 沪深交易所前缀（与新浪/聚合同类规则，供 Juhe `gid=sh600519` / `sz159915`）。
 * 常见误区：511、510、513 等 ETF 在上交所，首位是 5 不是 6，不能按「只有 6 开头才是沪市」判断。
 */
export function hsGidPrefixForSixDigit(code6: string): "sh" | "sz" {
  const c = code6.trim();
  // 深市：主板/中小/创业 000–003、300–302；ETF 159；LOF/基金 160–169、180–189 等
  if (
    /^(000|001|002|003|300|301|302)/.test(c) ||
    /^159/.test(c) ||
    /^1[6-8][0-9]{4}/.test(c)
  ) {
    return "sz";
  }
  // 沪市：A 股 60****–65****、科创板 688/689；证券基金/ETF 多为 50****–58****；B 股 9*****
  if (/^6[0-9]{5}/.test(c) || /^5[0-8][0-9]{4}/.test(c) || /^9[0-9]{5}/.test(c)) {
    return "sh";
  }
  // 其余少见编码默认深市（保守）
  return "sz";
}

/**
 * 将用户填入的股票代码解析为调用接口所需的结构。
 * 识别规则：
 *   1) 带 SH/SZ 前缀 → 沪深接口
 *   2) 带 HK 前缀 / 4-5 位纯数字 → 港股接口
 *   3) 6 位纯数字 → 沪深（按 `hsGidPrefixForSixDigit` 推断 sh/sz）
 *   4) 纯字母（可含 . 或 -）→ 美股
 */
export function parseStockSymbol(rawSymbol: string | null | undefined): StockSymbolInfo | null {
  // 兼容用户从财经站点粘贴的常见前缀/空白：$AAPL、 AAPL.US、AAPL.O、brk.b
  const s = (rawSymbol || "")
    .trim()
    .toUpperCase()
    .replace(/^\$+/, "")
    .replace(/\s+/g, "")
    // 去掉 .US / .O / .N / .OQ / .NSDQ 等后缀（仅美股常见）
    .replace(/\.(US|O|N|OQ|NSDQ|NYSE|NASDAQ)$/, "");
  if (!s) return null;

  if (/^(SH|SZ)\d{6}$/.test(s)) {
    return {
      market: "hs",
      apiParam: s.toLowerCase(),
      display: s,
      marketName: MARKET_NAME.hs
    };
  }
  if (/^HK\d{1,5}$/.test(s)) {
    const num = s.slice(2).padStart(5, "0");
    return {
      market: "hk",
      apiParam: num,
      display: `HK${num}`,
      marketName: MARKET_NAME.hk
    };
  }
  if (/^\d{6}$/.test(s)) {
    const prefix = hsGidPrefixForSixDigit(s);
    return {
      market: "hs",
      apiParam: `${prefix}${s}`,
      display: `${prefix}${s}`.toUpperCase(),
      marketName: MARKET_NAME.hs
    };
  }
  if (/^\d{4,5}$/.test(s)) {
    const num = s.padStart(5, "0");
    return {
      market: "hk",
      apiParam: num,
      display: `HK${num}`,
      marketName: MARKET_NAME.hk
    };
  }
  if (/^[A-Z][A-Z0-9.\-]*$/.test(s)) {
    return {
      market: "us",
      apiParam: s.toLowerCase(),
      display: s,
      marketName: MARKET_NAME.us
    };
  }
  return null;
}

type FetchPriceResult =
  | {
      ok: true;
      price: number;
      changeAmount: number | null;
      changePercent: number | null;
      /** 行情时间字段上的会话日。沪深/港股为当地日期，美股为美东交易日。 */
      quoteSessionYmd: string | null;
    }
  | { ok: false; error: string };

const TENCENT_QUOTE_MAX_ATTEMPTS = 3;
const TENCENT_QUOTE_RETRY_DELAY_MS = 1000;

/** 腾讯批量接口用的代码。沪深 apiParam 已是 sh/sz 前缀。 */
export function tencentQuoteCode(info: StockSymbolInfo): string {
  if (info.market === "hs") return info.apiParam.toLowerCase();
  if (info.market === "hk") return `hk${info.apiParam}`;
  return `us${info.apiParam.toUpperCase()}`;
}

function parseTencentQuoteFields(fields: string[]): FetchPriceResult {
  const name = fields[1]?.trim() ?? "";
  if (fields.length < 33 || !name) {
    return { ok: false, error: "未找到行情" };
  }
  const price = Number(fields[3]);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "未解析到价格字段" };
  }
  const amt = Number(fields[31]);
  const pct = Number(fields[32]);
  return {
    ok: true,
    price,
    changeAmount: Number.isFinite(amt) ? amt : null,
    changePercent: Number.isFinite(pct) ? pct / 100 : null,
    quoteSessionYmd: parseTencentQuoteTimeToSessionYmd(fields[30])
  };
}

function parseTencentQuoteBody(body: string): Map<string, FetchPriceResult> {
  const byCode = new Map<string, FetchPriceResult>();
  for (const match of body.matchAll(/v_([a-zA-Z0-9.]+)="([^"]*)"/g)) {
    byCode.set(match[1].toLowerCase(), parseTencentQuoteFields(match[2].split("~")));
  }
  return byCode;
}

async function fetchTencentQuoteBatchOnce(
  codes: string[]
): Promise<{ ok: true; byCode: Map<string, FetchPriceResult> } | { ok: false; error: string }> {
  try {
    const res = await undiciFetch(`${TENCENT_QUOTE_URL}${codes.join(",")}`, {
      headers: {
        accept: "text/plain,*/*",
        "user-agent": "asset-manager/1.0 (+node)"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const text = new TextDecoder("gbk").decode(await res.arrayBuffer());
    if (!text.trim()) return { ok: false, error: "空响应" };
    return { ok: true, byCode: parseTencentQuoteBody(text) };
  } catch (e: any) {
    const cause = e?.cause;
    const detail = [e?.message, cause?.code, cause?.message].filter(Boolean).join(" | ");
    return { ok: false, error: detail || "network error" };
  }
}

async function fetchTencentQuoteBatch(
  codes: string[]
): Promise<{ ok: true; byCode: Map<string, FetchPriceResult> } | { ok: false; error: string }> {
  let last: { ok: false; error: string } = { ok: false, error: "unknown" };
  for (let attempt = 1; attempt <= TENCENT_QUOTE_MAX_ATTEMPTS; attempt++) {
    const result = await fetchTencentQuoteBatchOnce(codes);
    if (result.ok) return result;
    last = result;
    if (attempt < TENCENT_QUOTE_MAX_ATTEMPTS) {
      console.warn(`[stocks] batch attempt ${attempt} failed (${result.error}), retrying...`);
      await new Promise((r) => setTimeout(r, TENCENT_QUOTE_RETRY_DELAY_MS));
    }
  }
  return last;
}

/** 股票接口调用日志保留时长（30 天） */
const STOCK_REFRESH_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface StockRefreshLogEntry {
  id: number;
  run_id: string;
  asset_id: number | null;
  asset_name: string | null;
  symbol: string | null;
  api_param: string | null;
  ok: boolean;
  price: number | null;
  error: string | null;
  force_refresh: boolean;
  created_at: string;
}

function newStockRefreshRunId(): string {
  return `${nowCn()}-${Date.now()}`;
}

function stockRefreshLogCutoffIso(): string {
  return toCnIso(new Date(Date.now() - STOCK_REFRESH_LOG_RETENTION_MS));
}

function pruneStockRefreshLogs(): void {
  const db = getDB();
  db.prepare(`DELETE FROM stock_refresh_log WHERE created_at < ?`).run(
    stockRefreshLogCutoffIso()
  );
}

function writeStockRefreshLog(entry: {
  runId: string;
  assetId?: number | null;
  assetName?: string | null;
  symbol?: string | null;
  apiParam?: string | null;
  ok: boolean;
  price?: number | null;
  error?: string | null;
  force?: boolean;
}): void {
  const db = getDB();
  db.prepare(
    `INSERT INTO stock_refresh_log
       (run_id, asset_id, asset_name, symbol, api_param, ok, price, error, force_refresh, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.runId,
    entry.assetId ?? null,
    entry.assetName ?? null,
    entry.symbol ?? null,
    entry.apiParam ?? null,
    entry.ok ? 1 : 0,
    entry.price ?? null,
    entry.error ?? null,
    entry.force ? 1 : 0,
    nowCn()
  );
  pruneStockRefreshLogs();
}

function logStockApiResult(
  runId: string,
  info: StockSymbolInfo,
  asset: { id: number; name: string; symbol: string | null },
  r: FetchPriceResult,
  force: boolean
): void {
  if (r.ok) {
    const msg = `[stocks] ${info.display} ok price=${r.price}`;
    console.log(msg);
    writeStockRefreshLog({
      runId,
      assetId: asset.id,
      assetName: asset.name,
      symbol: asset.symbol,
      apiParam: tencentQuoteCode(info),
      ok: true,
      price: r.price,
      force
    });
    return;
  }
  const msg = `[stocks] ${info.display} fail: ${r.error}`;
  console.warn(msg);
  writeStockRefreshLog({
    runId,
    assetId: asset.id,
    assetName: asset.name,
    symbol: asset.symbol,
    apiParam: tencentQuoteCode(info),
    ok: false,
    error: r.error,
    force
  });
}

/** 设置页展示：最近的股票接口调用记录 */
export function listRecentStockRefreshLogs(
  opts: { limit?: number; failuresOnly?: boolean } = {}
): StockRefreshLogEntry[] {
  const limit = opts.limit ?? 50;
  const db = getDB();
  const where = opts.failuresOnly ? "WHERE ok = 0" : "";
  const rows = db
    .prepare(
      `SELECT id, run_id, asset_id, asset_name, symbol, api_param, ok, price, error, force_refresh, created_at
       FROM stock_refresh_log
       ${where}
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      run_id: string;
      asset_id: number | null;
      asset_name: string | null;
      symbol: string | null;
      api_param: string | null;
      ok: number;
      price: number | null;
      error: string | null;
      force_refresh: number;
      created_at: string;
    }>;
  return rows.map((r) => ({
    id: r.id,
    run_id: r.run_id,
    asset_id: r.asset_id,
    asset_name: r.asset_name,
    symbol: r.symbol,
    api_param: r.api_param,
    ok: r.ok === 1,
    price: r.price,
    error: r.error,
    force_refresh: r.force_refresh === 1,
    created_at: r.created_at
  }));
}

export interface StockAssetView {
  asset_id: number;
  account_name: string;
  name: string;
  symbol: string | null;
  /** 解析成功的市场；无法解析则为 null */
  market: StockMarket | null;
  market_name: string | null;
  currency: string;
  current_price: number | null;
  quantity: number;
  unit_cost: number | null;
  updated_at: string;
}

export interface StockRefreshItem extends StockAssetView {
  previous_price: number | null;
  fetched_price: number | null;
  /** 接口返回的单股当日涨跌额（原币） */
  change_amount: number | null;
  /** 接口返回的当日涨跌幅（小数 0.0013 = 0.13%） */
  change_percent: number | null;
  updated: boolean;
  error?: string;
}

export interface StockRefreshResult {
  last_refreshed_at: string | null;
  next_refresh_at: string;
  skipped: "market_closed" | "up_to_date" | "no_securities" | null;
  updated_count: number;
  failed_count: number;
  error?: string;
  items: StockRefreshItem[];
}

/** 列出所有证券类资产（含无 symbol 的，用于 UI 显示警告） */
export function listSecuritiesForView(): StockAssetView[] {
  const db = getDB();
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.symbol, a.currency, a.current_price, a.quantity, a.unit_cost, a.updated_at,
              acc.name AS account_name
       FROM asset a
       JOIN account acc ON acc.id = a.account_id
       JOIN category c ON c.id = acc.category_id
       WHERE c.code = 'securities'
       ORDER BY a.name ASC`
    )
    .all() as Array<{
      id: number;
      name: string;
      symbol: string | null;
      currency: string;
      current_price: number | null;
      quantity: number;
      unit_cost: number | null;
      updated_at: string;
      account_name: string;
    }>;

  return rows.map((r) => {
    const info = r.symbol ? parseStockSymbol(r.symbol) : null;
    return {
      asset_id: r.id,
      account_name: r.account_name,
      name: r.name,
      symbol: r.symbol,
      market: info?.market ?? null,
      market_name: info?.marketName ?? null,
      currency: r.currency,
      current_price: r.current_price,
      quantity: r.quantity,
      unit_cost: r.unit_cost,
      updated_at: r.updated_at
    };
  });
}

function listSecuritiesWithSymbol(): AssetWithMeta[] {
  const db = getDB();
  return db
    .prepare(
      `SELECT a.*, acc.name AS account_name, acc.category_id,
              c.code AS category_code, c.name AS category_name
       FROM asset a
       JOIN account acc ON acc.id = a.account_id
       JOIN category c ON c.id = acc.category_id
       WHERE c.code = 'securities'
         AND a.symbol IS NOT NULL
         AND TRIM(a.symbol) <> ''`
    )
    .all() as AssetWithMeta[];
}

/**
 * 模块级内存锁：同一进程内只允许一次刷新并发执行。
 * 多页面同时触发 kickoffStockPricesRefresh 时，后续调用直接跳过，不重复调接口。
 */
let refreshInFlight = false;

/**
 * 刷新所有证券类资产的 current_price。
 * - 自动：任一市场开市，且距上次请求已满 15 分钟
 * - 强制：忽略开市与间隔，立刻拉一批
 */
export async function refreshStockPrices(
  opts: { force?: boolean; market?: StockMarket } = {}
): Promise<StockRefreshResult> {
  const lastRefreshedAt = getSetting("last_stocks_refresh_at");
  const next_refresh_at = nextStockAutoRefreshIso(lastRefreshedAt);

  if (refreshInFlight) {
    return {
      last_refreshed_at: lastRefreshedAt,
      next_refresh_at,
      skipped: "up_to_date",
      updated_count: 0,
      failed_count: 0,
      items: []
    };
  }

  if (!opts.force && !isAnyStockMarketOpen()) {
    return {
      last_refreshed_at: lastRefreshedAt,
      next_refresh_at,
      skipped: "market_closed",
      updated_count: 0,
      failed_count: 0,
      items: []
    };
  }

  if (!opts.force && !shouldRefreshStocks(lastRefreshedAt)) {
    return {
      last_refreshed_at: lastRefreshedAt,
      next_refresh_at,
      skipped: "up_to_date",
      updated_count: 0,
      failed_count: 0,
      items: []
    };
  }

  const assets = listSecuritiesWithSymbol().filter((asset) => {
    if (!opts.market) return true;
    return parseStockSymbol(asset.symbol)?.market === opts.market;
  });
  if (assets.length === 0) {
    return {
      last_refreshed_at: lastRefreshedAt,
      next_refresh_at,
      skipped: "no_securities",
      updated_count: 0,
      failed_count: 0,
      items: []
    };
  }

  const runId = newStockRefreshRunId();
  refreshInFlight = true;
  try {

  const db = getDB();
  /** 单条失败或接口额度错误不会 UPDATE 该行，不会清空已有涨跌；仅成功分支覆盖写入。 */
  const updateStmt = db.prepare(
    `UPDATE asset
       SET current_price = ?,
           change_amount = ?,
           change_percent = ?,
           change_quote_date = ?,
           updated_at = ?
       WHERE id = ?`
  );
  const upsertPriceDaily = db.prepare(
    `INSERT INTO stock_price_daily (asset_id, date, price)
     VALUES (?, ?, ?)
     ON CONFLICT(asset_id, date) DO UPDATE SET price = excluded.price`
  );

  const items: StockRefreshItem[] = [];
  let updatedCount = 0;
  let failedCount = 0;

  const parsed = assets.map((asset) => ({ asset, info: parseStockSymbol(asset.symbol) }));
  const codes = parsed.flatMap(({ info }) => (info ? [tencentQuoteCode(info)] : []));
  const batch = codes.length > 0 ? await fetchTencentQuoteBatch(codes) : null;

  for (const { asset, info } of parsed) {
    const quoteCode = info ? tencentQuoteCode(info) : null;
    const base: StockRefreshItem = {
      asset_id: asset.id,
      account_name: asset.account_name,
      name: asset.name,
      symbol: asset.symbol,
      market: info?.market ?? null,
      market_name: info?.marketName ?? null,
      currency: asset.currency,
      current_price: asset.current_price,
      quantity: asset.quantity,
      unit_cost: asset.unit_cost,
      updated_at: asset.updated_at,
      previous_price: asset.current_price,
      fetched_price: null,
      change_amount: null,
      change_percent: null,
      updated: false
    };

    let r: FetchPriceResult;
    if (!info || !quoteCode) {
      r = { ok: false, error: "无法识别股票代码" };
    } else if (!batch || !batch.ok) {
      r = { ok: false, error: batch?.error ?? "未请求行情" };
    } else {
      r = batch.byCode.get(quoteCode.toLowerCase()) ?? { ok: false, error: "未返回该代码" };
    }

    if (info) logStockApiResult(runId, info, asset, r, !!opts.force);
    else {
      writeStockRefreshLog({
        runId,
        assetId: asset.id,
        assetName: asset.name,
        symbol: asset.symbol,
        ok: false,
        error: r.ok ? undefined : r.error,
        force: !!opts.force
      });
      console.warn(`[stocks] ${asset.symbol ?? asset.name} fail: ${r.ok ? "" : r.error}`);
    }

    if (r.ok) {
      const now = nowCn();
      const quoteToStore = r.quoteSessionYmd;
      updateStmt.run(
        r.price,
        r.changeAmount,
        r.changePercent,
        quoteToStore,
        now,
        asset.id
      );
      if (quoteToStore) {
        upsertPriceDaily.run(asset.id, quoteToStore, r.price);
      }
      base.fetched_price = r.price;
      base.current_price = r.price;
      base.change_amount = r.changeAmount;
      base.change_percent = r.changePercent;
      base.updated_at = now;
      base.updated = true;
      updatedCount++;
    } else {
      base.error = r.error;
      failedCount++;
    }
    items.push(base);
  }

  // 仅完整刷新才能推进全局自动刷新时间；单市场手动刷新不能让其它市场被误判为已刷新。
  // 水位记到分钟，否则整点精度会让 15 分钟间隔在同一小时内反复触发。
  if (!opts.market && (updatedCount > 0 || failedCount > 0)) {
    setSetting("last_stocks_refresh_at", nowCnMinute());
  }

  const batchError =
    updatedCount === 0 && failedCount > 0
      ? items.find((i) => i.error)?.error ?? "股票价格刷新失败"
      : undefined;
  if (batchError) {
    setSetting(SETTING_LAST_STOCKS_REFRESH_ERROR, batchError);
  } else if (updatedCount > 0) {
    removeSetting(SETTING_LAST_STOCKS_REFRESH_ERROR);
  }

  if (updatedCount > 0) {
    try {
      recordSnapshot((getSetting("base_currency") ?? "CNY").toUpperCase());
    } catch (e: any) {
      console.warn("[stocks] valuation snapshot after refresh failed:", e?.message ?? e);
    }
  }

  console.log(
    `[stocks] refresh done run=${runId} updated=${updatedCount} failed=${failedCount} force=${!!opts.force}`
  );

  const refreshedAt = getSetting("last_stocks_refresh_at");
  return {
    last_refreshed_at: refreshedAt,
    next_refresh_at: nextStockAutoRefreshIso(refreshedAt),
    skipped: null,
    updated_count: updatedCount,
    failed_count: failedCount,
    error: batchError,
    items
  };

  } finally {
    refreshInFlight = false;
  }
}

export async function ensureStockPrices() {
  try {
    await refreshStockPrices({ force: false });
  } catch (e) {
    console.error("[stocks] ensure failed:", e);
  }
}

/**
 * 非阻塞版：触发后台刷新但立即返回，不阻塞 SSR 首屏。
 * 第一次访问（DB 中无价格）时页面会用旧数据/空数据，下次刷新即可看到最新价格。
 */
export function kickoffStockPricesRefresh(): void {
  refreshStockPrices({ force: false }).catch((e) => {
    console.warn("[stocks] background refresh failed:", e?.message ?? e);
  });
}

/** 读取上次刷新时间（用于设置页在未触发刷新时也能展示） */
export function getLastStocksRefreshAt(): string | null {
  const v = getSetting("last_stocks_refresh_at");
  if (!v) return null;
  const d = parseDbDate(v);
  return Number.isNaN(d.getTime()) ? null : v;
}

export function getLastStocksRefreshError(): string | null {
  const v = getSetting(SETTING_LAST_STOCKS_REFRESH_ERROR)?.trim();
  return v || null;
}
