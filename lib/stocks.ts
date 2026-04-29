import { fetch as undiciFetch } from "undici";
import { getProxyDispatcher } from "./net";
import { getDB, getSetting, setSetting, type AssetWithMeta } from "./db";
import { getJuheStockAppKey } from "./juheKeys";
import {
  latestPassedCnStockAnchorMs,
  nextStockAutoRefreshIso,
  nowCn,
  parseDbDate,
  shouldRefreshStocksBy10And14
} from "./time";

/**
 * 聚合数据「股票数据」接口（与汇率的 AppKey 在设置中分别配置，也可分别用环境变量覆盖）。
 * 三市对应三个 endpoint：
 *   - 沪深 A 股（含上证/深证指数）：/finance/stock/hs?gid=sh601009
 *   - 香港股市：/finance/stock/hk?num=00001
 *   - 美国股市：/finance/stock/usa?gid=aapl
 * 数据延迟约数分钟，自动拉取在每日北京时间 10:00 与 14:00 两个锚点各最多一次（见 time.ts）。
 */

const JUHE_STOCK_ENDPOINT: Record<StockMarket, string> = {
  hs: "https://web.juhe.cn/finance/stock/hs",
  hk: "https://web.juhe.cn/finance/stock/hk",
  us: "https://web.juhe.cn/finance/stock/usa"
};

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
  const s = (rawSymbol || "").trim().toUpperCase();
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

interface JuheStockResp {
  resultcode?: string;
  error_code?: number;
  reason?: string;
  result?: Array<{ data?: Record<string, string | number | undefined> }> | null;
}

function extractPrice(market: StockMarket, data: Record<string, unknown>): number | null {
  // 沪深返回 nowPri；港股/美股返回 lastestpri
  const raw = market === "hs" ? data.nowPri : data.lastestpri;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 解析单股「当日涨跌」字段。三市字段名差异：
 *   HS: increase（涨跌额，已是绝对值带正负）、increPer（涨跌幅，单位 %）
 *   HK: uppic（涨跌额）、limit（涨跌幅，单位 %）
 *   US: uppic（涨跌额）、limit（涨跌幅，单位 %）
 * 注意：接口返回的是百分号下的原始数（0.13 表示 0.13%），这里统一换成小数（0.0013）。
 */
function extractChange(
  market: StockMarket,
  data: Record<string, unknown>
): { changeAmount: number | null; changePercent: number | null } {
  const rawAmount = market === "hs" ? data.increase : data.uppic;
  const rawPercent = market === "hs" ? data.increPer : data.limit;
  const amt = rawAmount == null ? NaN : Number(rawAmount);
  const pct = rawPercent == null ? NaN : Number(rawPercent);
  return {
    changeAmount: Number.isFinite(amt) ? amt : null,
    // 接口的 0.13 表示 0.13%；除以 100 转成纯小数
    changePercent: Number.isFinite(pct) ? pct / 100 : null
  };
}

function isFatalJuheCode(code: number): boolean {
  return [10001, 10002, 10003, 10004, 10005, 10007, 10008, 10009, 10011, 10012, 10021].includes(
    code
  );
}

type FetchPriceResult =
  | {
      ok: true;
      price: number;
      changeAmount: number | null;
      changePercent: number | null;
      rawTime?: string | number;
      name?: string | number;
    }
  | { ok: false; fatal: boolean; error: string };

async function fetchPriceFromJuhe(
  info: StockSymbolInfo,
  appkey: string
): Promise<FetchPriceResult> {
  const endpoint = JUHE_STOCK_ENDPOINT[info.market];
  const u = new URL(endpoint);
  u.searchParams.set("key", appkey);
  if (info.market === "hk") {
    u.searchParams.set("num", info.apiParam);
  } else {
    u.searchParams.set("gid", info.apiParam);
  }

  try {
    const res = await undiciFetch(u.toString(), {
      dispatcher: getProxyDispatcher(),
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "asset-manager/1.0 (+node)"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return { ok: false, fatal: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as JuheStockResp;
    const code = Number(json.error_code ?? json.resultcode ?? 0);
    // resultcode=200 与 error_code=0 均代表成功；两者是聚合数据新旧两套错误码
    const success = code === 0 || code === 200;
    if (!success) {
      return {
        ok: false,
        fatal: isFatalJuheCode(code),
        error: json.reason ?? `code=${code}`
      };
    }
    const first = Array.isArray(json.result) ? json.result[0] : undefined;
    const data = first?.data;
    if (!data) {
      return { ok: false, fatal: false, error: "未返回数据体" };
    }
    const price = extractPrice(info.market, data as Record<string, unknown>);
    if (price == null) {
      return { ok: false, fatal: false, error: "未解析到价格字段" };
    }
    const { changeAmount, changePercent } = extractChange(
      info.market,
      data as Record<string, unknown>
    );
    return {
      ok: true,
      price,
      changeAmount,
      changePercent,
      rawTime: data.time as string | number | undefined,
      name: data.name as string | number | undefined
    };
  } catch (e: any) {
    const cause = e?.cause;
    const detail = [e?.message, cause?.code, cause?.message].filter(Boolean).join(" | ");
    console.error(`[stocks] fetch ${info.display} failed:`, detail);
    return { ok: false, fatal: false, error: detail || "network error" };
  }
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
  skipped:
    | "before_morning"
    | "up_to_date"
    | "no_securities"
    | "no_key"
    | null;
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
 * 刷新所有证券类资产的 current_price。
 * - 自动：需已过当日第一个锚点 10:00，且 10/14 点对应的「本阶段」尚未拉取
 * - 强制：只校验已配置「股票数据」用 AppKey
 */
export async function refreshStockPrices(
  opts: { force?: boolean } = {}
): Promise<StockRefreshResult> {
  const lastRefreshedAt = getSetting("last_stocks_refresh_at");
  const next_refresh_at = nextStockAutoRefreshIso();
  const appkey = getJuheStockAppKey();

  if (!appkey) {
    return {
      last_refreshed_at: lastRefreshedAt,
      next_refresh_at,
      skipped: "no_key",
      updated_count: 0,
      failed_count: 0,
      error:
        "请先在「设置」中配置股票价格 AppKey，或使用环境变量 JUHE_STOCK_APPKEY",
      items: []
    };
  }

  if (!opts.force) {
    if (latestPassedCnStockAnchorMs() == null) {
      return {
        last_refreshed_at: lastRefreshedAt,
        next_refresh_at,
        skipped: "before_morning",
        updated_count: 0,
        failed_count: 0,
        items: []
      };
    }
    if (!shouldRefreshStocksBy10And14(lastRefreshedAt)) {
      return {
        last_refreshed_at: lastRefreshedAt,
        next_refresh_at,
        skipped: "up_to_date",
        updated_count: 0,
        failed_count: 0,
        items: []
      };
    }
  }

  const assets = listSecuritiesWithSymbol();
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

  const db = getDB();
  const updateStmt = db.prepare(
    `UPDATE asset
       SET current_price = ?,
           change_amount = ?,
           change_percent = ?,
           updated_at = ?
       WHERE id = ?`
  );

  const items: StockRefreshItem[] = [];
  let updatedCount = 0;
  let failedCount = 0;
  let fatalHit = false;
  let fatalReason: string | undefined;

  for (const asset of assets) {
    const info = parseStockSymbol(asset.symbol);
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

    if (!info) {
      base.error = "无法识别股票代码";
      failedCount++;
      items.push(base);
      continue;
    }
    if (fatalHit) {
      base.error = fatalReason ?? "接口额度不足，已跳过";
      failedCount++;
      items.push(base);
      continue;
    }

    const r = await fetchPriceFromJuhe(info, appkey);
    if (r.ok) {
      const now = nowCn();
      updateStmt.run(r.price, r.changeAmount, r.changePercent, now, asset.id);
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
      if (r.fatal) {
        fatalHit = true;
        fatalReason = r.error;
      }
    }
    items.push(base);
  }

  // 仅在「本次实际调用过接口」的前提下，写最后刷新时间
  if (updatedCount > 0 || failedCount > 0) {
    setSetting("last_stocks_refresh_at", nowCn());
  }

  return {
    last_refreshed_at: getSetting("last_stocks_refresh_at"),
    next_refresh_at,
    skipped: null,
    updated_count: updatedCount,
    failed_count: failedCount,
    error:
      updatedCount === 0 && failedCount > 0
        ? fatalReason ?? items.find((i) => i.error)?.error ?? "股票价格刷新失败"
        : undefined,
    items
  };
}

export async function ensureStockPrices() {
  try {
    await refreshStockPrices({ force: false });
  } catch (e) {
    console.error("[stocks] ensure failed:", e);
  }
}

/** 读取上次刷新时间（用于设置页在未触发刷新时也能展示） */
export function getLastStocksRefreshAt(): string | null {
  const v = getSetting("last_stocks_refresh_at");
  if (!v) return null;
  const d = parseDbDate(v);
  return Number.isNaN(d.getTime()) ? null : v;
}
