import {
  getDB,
  type AssetRow,
  type AssetChange,
  type AssetValuationDaily,
  type PortfolioSnapshot
} from "./db";
import { convert, getRate } from "./fx";
import { computeAssetValue, valueAll } from "./valuation";
import { isUsQuoteDateInDisplayWindow, nowCn, todayCn } from "./time";
import { parseStockSymbol } from "./stocks";
import { CHANGE_LOG_PAGE_SIZE, type ChangeLogFilters } from "./changeLog";
import { calculateHistoricalFxImpact, type FxImpactEntry } from "./historicalFxImpact";

const CHANGE_INSTANT = "julianday(created_at)";

/** 变动日志的日期筛选以北京午夜为边界，兼容旧无时区 UTC 与带偏移时间戳。 */
function changeDateRange(from?: string, to?: string) {
  const clauses: string[] = [];
  const args: string[] = [];
  if (from) {
    clauses.push(`${CHANGE_INSTANT} >= julianday(?)`);
    args.push(`${from}T00:00:00+08:00`);
  }
  if (to) {
    clauses.push(`${CHANGE_INSTANT} < julianday(?, '+1 day')`);
    args.push(`${to}T00:00:00+08:00`);
  }
  return { clauses, args };
}

/**
 * 从今天第一条「份额变更」记录反推「今日第一次改仓前」的持仓股数。
 *
 * 取北京日内最早有效的 quantity 变更前值，包含当天已卖出的份额。
 * 无有效变更记录时使用当前股数。
 */
export function mapSecurityQuantityBeforeFirstEditToday(
  assetIds: number[],
  currentQtyById: Map<number, number>
): Map<number, number> {
  if (assetIds.length === 0) return new Map();
  const today = todayCn();
  const { clauses, args } = changeDateRange(today, today);
  const db = getDB();
  const ph = assetIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT asset_id, field_changes
       FROM asset_change
       WHERE asset_id IN (${ph})
         AND action = 'update'
         AND ${clauses.join(" AND ")}
         AND CASE WHEN json_valid(field_changes) THEN
               json_extract(field_changes, '$.quantity.from') IS NOT NULL
               AND json_extract(field_changes, '$.quantity.to') IS NOT NULL
             END
       ORDER BY asset_id, ${CHANGE_INSTANT} ASC, id ASC`
    )
    .all(...assetIds, ...args) as Array<{ asset_id: number; field_changes: string }>;

  const firstQuantity = new Map<number, number>();
  for (const row of rows) {
    if (firstQuantity.has(row.asset_id)) continue;
    const { quantity } = JSON.parse(row.field_changes) as { quantity: { from: unknown; to: unknown } };
    const { from, to } = quantity;
    if ((typeof from !== "number" && typeof from !== "string") ||
        (typeof to !== "number" && typeof to !== "string")) continue;
    const previous = Number(from);
    if (Number.isFinite(previous) && Number.isFinite(Number(to))) firstQuantity.set(row.asset_id, previous);
  }
  return new Map(assetIds.map(id => [id, firstQuantity.get(id) ?? currentQtyById.get(id) ?? 0]));
}

/** 单只股票的「行情会话日盈亏」分项数据（来自股票行情接口落库的当日涨跌字段） */
export interface TodayPnLEntry {
  assetId: number;
  /** 该笔涨跌对应的市场交易日 `YYYY-MM-DD` */
  quoteDate: string;
  /** 单价的今日变化（原币） */
  todayPriceChange: number;
  /** 单价的今日涨跌幅（小数：0.0013 = 0.13%） */
  todayChangePct: number;
  /** 持仓维度的今日盈亏（原币） */
  todayPnLNative: number;
  /** 持仓维度的今日盈亏（基准币） */
  todayPnLBase: number;
}

export function logAssetChange(params: {
  action: "create" | "update" | "delete";
  before?: AssetRow | null;
  after?: AssetRow | null;
  extraChanges?: Record<string, { from: unknown; to: unknown }>;
  /** 业务归属时间。补记停机期间的利息时用对应北京日，而不是醒来的时刻。 */
  createdAt?: string;
}) {
  const { action, before, after, extraChanges } = params;
  const db = getDB();
  const target = after ?? before;
  if (!target) return;

  let fieldChanges: Record<string, { from: unknown; to: unknown }> | null = null;
  if (action === "update" && before && after) {
    fieldChanges = {};
    const keys: (keyof AssetRow)[] = [
      "account_id",
      "symbol",
      "name",
      "currency",
      "quantity",
      "unit_cost",
      "current_price",
      "amount",
      "annual_rate",
      "start_date",
      "maturity_date",
      "notes"
    ];
    for (const k of keys) {
      if ((before as any)[k] !== (after as any)[k]) {
        fieldChanges[k as string] = { from: (before as any)[k], to: (after as any)[k] };
      }
    }
    if (extraChanges) Object.assign(fieldChanges, extraChanges);
    if (Object.keys(fieldChanges).length === 0) return;
  }

  const category = db.prepare(`SELECT c.code FROM account acc
    JOIN category c ON c.id = acc.category_id WHERE acc.id = ?`)
    .get(target.account_id) as { code: string } | undefined;
  const nativeValue = computeAssetValue(target);
  const baseValueCny = convert(nativeValue, target.currency, "CNY");
  // B4: 负债大类的 base_value_cny 取负展示，避免"最近变动"看起来像收益增加
  let valueCny: number | null = baseValueCny ?? null;
  if (valueCny != null) {
    const catRow = db
      .prepare(
        `SELECT c.code AS code FROM account a
         JOIN category c ON c.id = a.category_id
         WHERE a.id = ?`
      )
      .get(target.account_id) as { code: string } | undefined;
    if (catRow?.code === "liability") {
      valueCny = -Math.abs(valueCny);
    }
  }

  db.prepare(
    `INSERT INTO asset_change
     (asset_id, account_id, asset_name, action, field_changes, snapshot, base_value_cny, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    after?.id ?? before?.id ?? null,
    target.account_id,
    target.name,
    action,
    fieldChanges ? JSON.stringify(fieldChanges) : extraChanges ? JSON.stringify(extraChanges) : null,
    JSON.stringify({ ...target, category_code: category?.code ?? null }),
    valueCny,
    params.createdAt ?? nowCn()
  );
}

export function listChanges(limit = 200): AssetChange[] {
  const db = getDB();
  return db
    .prepare(`SELECT * FROM asset_change ORDER BY ${CHANGE_INSTANT} DESC, id DESC LIMIT ?`)
    .all(limit) as AssetChange[];
}

export interface ChangeLogPage {
  changes: AssetChange[];
  total: number;
  page: number;
  pageCount: number;
}

/** 仅供历史页日志展示；总览最近变动、事件归因和盈亏计算不使用这里的分页。 */
export function listChangesPage(filters: ChangeLogFilters): ChangeLogPage {
  if (filters.error) return { changes: [], total: 0, page: 1, pageCount: 1 };
  const db = getDB();
  const { clauses: where, args } = changeDateRange(filters.from, filters.to);
  if (filters.type !== "all") {
    // 与 getChangeLogType 保持一致；损坏的旧 JSON 回落为普通修改，不能阻断查询。
    where.push(`(CASE
      WHEN action <> 'update' THEN action
      WHEN json_valid(field_changes) THEN CASE
        WHEN json_extract(field_changes, '$.cash_flow_type.to') IN ('deposit', 'expense', 'interest')
          THEN json_extract(field_changes, '$.cash_flow_type.to')
        WHEN json_type(field_changes, '$.dividend_amount.to') IN ('integer', 'real') THEN 'dividend'
        ELSE 'update' END
      ELSE 'update' END) = ?`);
    args.push(filters.type);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM asset_change ${whereSql}`).get(...args) as { total: number };
    const pageCount = Math.max(1, Math.ceil(total / CHANGE_LOG_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const changes = db.prepare(`SELECT * FROM asset_change ${whereSql}
      ORDER BY ${CHANGE_INSTANT} DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, CHANGE_LOG_PAGE_SIZE, (page - 1) * CHANGE_LOG_PAGE_SIZE) as AssetChange[];
    return { changes, total, page, pageCount };
  })();
}

export interface CashFlowEntry {
  id: number;
  type: "deposit" | "expense" | "interest";
  /** 带方向的原币金额：入金为正，消费为负。 */
  amount: number;
  reason: string;
  createdAt: string;
}

/** 从资产变动日志中提取指定现金资产的人工入金/消费记录。 */
export function listCashFlowEntries(assetId: number, limit = 50): CashFlowEntry[] {
  const rows = getDB()
    .prepare(
      `SELECT id, field_changes, created_at
       FROM asset_change
       WHERE asset_id = ?
         AND action = 'update'
         AND CASE
               WHEN json_valid(field_changes)
               THEN json_extract(field_changes, '$.cash_flow_type.to')
             END IN ('deposit', 'expense', 'interest')
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(assetId, limit) as Array<{ id: number; field_changes: string; created_at: string }>;

  const entries: CashFlowEntry[] = [];
  for (const row of rows) {
    try {
      const changes = JSON.parse(row.field_changes) as Record<string, { to?: unknown }>;
      const type = changes.cash_flow_type?.to;
      const amount = Number(changes.cash_flow_amount?.to);
      const reason = String(changes.cash_flow_reason?.to ?? "").trim();
      if ((type !== "deposit" && type !== "expense" && type !== "interest") || !Number.isFinite(amount) || !reason) continue;
      entries.push({ id: row.id, type, amount, reason, createdAt: row.created_at });
    } catch {
      /* 忽略损坏的历史记录，不影响现金资产页渲染 */
    }
  }
  return entries;
}

export function recordSnapshot(baseCurrency: string): PortfolioSnapshot {
  const db = getDB();
  const { total, byCategory, items } = valueAll(baseCurrency);
  const today = todayCn();
  const capturedAt = nowCn();
  const rateByCurrency = new Map<string, number | null>();
  for (const item of items) {
    if (!rateByCurrency.has(item.currency)) {
      rateByCurrency.set(item.currency, getRate(item.currency, baseCurrency));
    }
  }
  const upsertSnapshot = db.prepare(
    `INSERT INTO portfolio_snapshot (date, base_currency, total_value, breakdown, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date, base_currency) DO UPDATE SET
       total_value = excluded.total_value,
       breakdown = excluded.breakdown,
       created_at = excluded.created_at`
  );
  const clearDaily = db.prepare(
    "DELETE FROM asset_valuation_daily WHERE date = ? AND base_currency = ?"
  );
  const insertDaily = db.prepare(
    `INSERT INTO asset_valuation_daily
     (date, base_currency, asset_id, account_id, asset_name, category_code,
      currency, quantity, unit_cost, unit_price, amount, native_value,
      fx_rate, base_value, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    upsertSnapshot.run(today, baseCurrency, total, JSON.stringify(byCategory), capturedAt);
    // 当日快照语义是“当天最新状态”，先清掉同日旧明细，避免已删除资产残留。
    clearDaily.run(today, baseCurrency);
    for (const item of items) {
      insertDaily.run(
        today,
        baseCurrency,
        item.id,
        item.account_id,
        item.name,
        item.category_code,
        item.currency,
        item.quantity,
        item.unit_cost,
        item.current_price ?? item.unit_cost ?? null,
        item.amount,
        item.native_value,
        rateByCurrency.get(item.currency) ?? null,
        item.base_value,
        capturedAt
      );
    }
  })();
  return db
    .prepare("SELECT * FROM portfolio_snapshot WHERE date = ? AND base_currency = ?")
    .get(today, baseCurrency) as PortfolioSnapshot;
}

export interface ListAssetValuationsOptions {
  baseCurrency: string;
  from?: string;
  to?: string;
  assetId?: number;
  limit?: number;
}

/** 逐资产每日估值历史；默认返回最近写入的记录。 */
export function listAssetValuations(
  options: ListAssetValuationsOptions
): AssetValuationDaily[] {
  const clauses = ["base_currency = ?"];
  const params: Array<string | number> = [options.baseCurrency.toUpperCase()];
  if (options.from) {
    clauses.push("date >= ?");
    params.push(options.from);
  }
  if (options.to) {
    clauses.push("date <= ?");
    params.push(options.to);
  }
  if (options.assetId != null) {
    clauses.push("asset_id = ?");
    params.push(options.assetId);
  }
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 5000), 20000));
  params.push(limit);
  return getDB()
    .prepare(
      `SELECT * FROM asset_valuation_daily
       WHERE ${clauses.join(" AND ")}
       ORDER BY date DESC, asset_id ASC
       LIMIT ?`
    )
    .all(...params) as AssetValuationDaily[];
}

export interface FxImpactSummary {
  baseCurrency: string;
  from: string;
  to: string;
  hasPreviousSnapshot: boolean;
  hasCurrentSnapshot: boolean;
  hasPreviousValuation: boolean;
  hasCurrentValuation: boolean;
  totalBaseValueChange: number;
  totalFxImpact: number;
  totalNativeValueImpact: number;
  unclassifiedBaseValueChange: number;
  byCurrency: FxImpactEntry[];
}

/**
 * 比较两个已存在的逐资产日快照，并把净值变化对称拆成“原币价值变化”和“汇率变化”。
 * 新出现/消失的币种或缺失汇率不猜测，计入 unclassifiedBaseValueChange。
 */
export function summarizeFxImpact(
  baseCurrency: string,
  from: string,
  to: string
): FxImpactSummary {
  const db = getDB();
  const rows = db
    .prepare(
      `SELECT date, currency, category_code, native_value, fx_rate, base_value
       FROM asset_valuation_daily
       WHERE base_currency = ? AND date IN (?, ?)`
    )
    .all(baseCurrency.toUpperCase(), from, to) as Array<{
      date: string;
      currency: string;
      category_code: AssetValuationDaily["category_code"];
      native_value: number;
      fx_rate: number | null;
      base_value: number;
    }>;
  const snapshots = db
    .prepare(
      `SELECT date, total_value
       FROM portfolio_snapshot
       WHERE base_currency = ? AND date IN (?, ?)`
    )
    .all(baseCurrency.toUpperCase(), from, to) as Array<{
      date: string;
      total_value: number;
    }>;
  const previousSnapshot = snapshots.find((row) => row.date === from);
  const currentSnapshot = snapshots.find((row) => row.date === to);
  const previousRows = rows.filter((row) => row.date === from);
  const currentRows = rows.filter((row) => row.date === to);
  const { byCurrency, totalBaseValueChange } = calculateHistoricalFxImpact(
    previousRows, currentRows, previousSnapshot?.total_value, currentSnapshot?.total_value
  );
  let totalFxImpact = 0;
  let totalNativeValueImpact = 0;
  let comparableBaseValueChange = 0;
  for (const entry of byCurrency) {
    totalFxImpact += entry.fxImpact ?? 0;
    totalNativeValueImpact += entry.nativeValueImpact ?? 0;
    if (entry.comparable) comparableBaseValueChange += entry.baseValueChange;
  }
  byCurrency.sort((a, b) => Math.abs(b.baseValueChange) - Math.abs(a.baseValueChange));

  return {
    baseCurrency: baseCurrency.toUpperCase(),
    from,
    to,
    hasPreviousSnapshot: previousSnapshot != null,
    hasCurrentSnapshot: currentSnapshot != null,
    hasPreviousValuation: previousRows.length > 0,
    hasCurrentValuation: currentRows.length > 0,
    totalBaseValueChange,
    totalFxImpact,
    totalNativeValueImpact,
    unclassifiedBaseValueChange: totalBaseValueChange - comparableBaseValueChange,
    byCurrency
  };
}

export function listSnapshots(baseCurrency: string, limit = 365, range: { from?: string; to?: string } = {}): PortfolioSnapshot[] {
  const db = getDB();
  const where = ["base_currency = ?"];
  const args: Array<string | number> = [baseCurrency];
  if (range.from) { where.push("date >= ?"); args.push(range.from); }
  if (range.to) { where.push("date <= ?"); args.push(range.to); }
  return (db
    .prepare(
      `SELECT * FROM portfolio_snapshot
       WHERE ${where.join(" AND ")}
       ORDER BY date DESC
       LIMIT ?`
    )
    .all(...args, Math.max(1, Math.trunc(limit))) as PortfolioSnapshot[]).reverse();
}

/** 从组合快照里提取证券大类的历史总值曲线 */
export function listSecuritiesBreakdown(
  baseCurrency: string,
  days = 365
): Array<{ date: string; value: number }> {
  return listSnapshots(baseCurrency, days).flatMap(snapshot => {
    try {
      const breakdown = JSON.parse(snapshot.breakdown ?? "null");
      if (!breakdown || typeof breakdown !== "object") return [];
      const value = Number(breakdown.securities ?? 0);
      return Number.isFinite(value) ? [{ date: snapshot.date, value }] : [];
    } catch { return []; }
  });
}

/**
 * 行情会话日盈亏（证券）：沪深/港股仅统计北京时间今天；美股统计所有美股持仓中
 * 最新的有效交易日，且只允许北京今天或昨天的日期（次日结束后过期）。
 * 空日期不计入，且不同美股交易日不会混在同一次汇总中。
 * 单价涨跌由 `change_percent` + `current_price` 反推（`change_amount` 精度不足，见下）；
 * 股数用 `mapSecurityQuantityBeforeFirstEditToday`（当日减仓按日初股数）。
 */
export function computeTodayStockPnL(
  items: Array<{
    id: number;
    currency: string;
    quantity: number;
    currentPrice: number | null;
    changePercent: number | null;
    market?: "hs" | "hk" | "us" | null;
    /** 行情会话日 `YYYY-MM-DD` */
    changeQuoteDate?: string | null;
  }>,
  baseCurrency: string
): {
  totalBase: number;
  availableTotalBase: number | null;
  status: "complete" | "partial" | "unavailable";
  missingRates: string[];
  eligibleCount: number;
  closedPositionCount: number;
  closedPositions: Array<{ id: number; name: string; symbol: string | null; currency: string; quoteDate: string; pnlBase: number }>;
  perAsset: Map<number, TodayPnLEntry>;
  sessionDates: { cnHk: string; us: string | null };
} {
  const perAsset = new Map<number, TodayPnLEntry>();
  let totalBase = 0;
  const today = todayCn();
  // 清仓会删除当前资产，必须从当天删除记录保留的状态取回计算候选。
  // 旧记录若没有分类依据，不猜测；不合并已复用 ID 的旧历史。
  const existingIds = new Set(items.map(item => item.id));
  const { clauses, args } = changeDateRange(today, today);
  const removed = getDB().prepare(`SELECT asset_id, snapshot FROM asset_change
    WHERE action = 'delete' AND ${clauses.join(" AND ")}
    ORDER BY ${CHANGE_INSTANT} DESC, id DESC`).all(...args) as Array<{ asset_id: number; snapshot: string | null }>;
  const closed = new Map<number, AssetRow>();
  for (const row of removed) {
    if (existingIds.has(row.asset_id) || closed.has(row.asset_id) || !row.snapshot) continue;
    try {
      const asset = JSON.parse(row.snapshot) as AssetRow & { category_code?: string };
      if (asset.category_code !== "securities" || asset.id !== row.asset_id) continue;
      closed.set(asset.id, asset);
    } catch { /* 无法验证的历史不参与 */ }
  }
  items = [...items, ...Array.from(closed.values()).map(asset => ({
    id: asset.id, currency: asset.currency, quantity: asset.quantity ?? 0,
    currentPrice: asset.current_price, changePercent: asset.change_percent,
    changeQuoteDate: asset.change_quote_date, market: parseStockSymbol(asset.symbol)?.market ?? null
  }))];
  const missingRates = new Set<string>();
  let eligibleCount = 0;
  const latestUsQuoteDate =
    items
      .filter(
        (item) =>
          item.market === "us" &&
          item.quantity > 0 &&
          isUsQuoteDateInDisplayWindow(item.changeQuoteDate, today)
      )
      .map((item) => item.changeQuoteDate!)
      .sort()
      .at(-1) ?? null;

  const currentQtyById = new Map<number, number>();
  for (const it of items) {
    currentQtyById.set(it.id, it.quantity ?? 0);
  }
  const qtyDayStartById = mapSecurityQuantityBeforeFirstEditToday(
    items.map((i) => i.id),
    currentQtyById
  );

  for (const item of items) {
    const qtyDayStart = qtyDayStartById.get(item.id) ?? (item.quantity ?? 0);
    if (qtyDayStart <= 0) continue;
    eligibleCount++;

    const expectedQuoteDate = item.market === "us" ? latestUsQuoteDate : today;
    if (!item.changeQuoteDate || item.changeQuoteDate !== expectedQuoteDate) {
      continue;
    }

    // 单价涨跌一律由涨跌幅反推，不用 change_amount：聚合接口的涨跌额只给两位小数，
    // 低价标的（0.536 元的 ETF 跌 0.37%）会被截断成 0.00，盈亏就成了 0。
    // current = prev * (1 + pct) ⇒ prev = current / (1 + pct) ⇒ change = current - prev
    if (
      item.changePercent == null ||
      !Number.isFinite(item.changePercent) ||
      item.currentPrice == null ||
      item.changePercent === -1
    ) {
      continue;
    }
    const prevPrice = item.currentPrice / (1 + item.changePercent);
    const todayPriceChange = item.currentPrice - prevPrice;
    const todayChangePct = item.changePercent;

    const todayPnLNative = todayPriceChange * qtyDayStart;
    const todayPnLBase = convert(todayPnLNative, item.currency, baseCurrency);
    if (todayPnLBase == null) {
      missingRates.add(`${item.currency}->${baseCurrency}`);
      continue;
    }
    perAsset.set(item.id, {
      assetId: item.id,
      quoteDate: item.changeQuoteDate,
      todayPriceChange,
      todayChangePct,
      todayPnLNative,
      todayPnLBase
    });
    totalBase += todayPnLBase;
  }

  return {
    totalBase,
    availableTotalBase: perAsset.size > 0 ? totalBase : null,
    status: perAsset.size === 0 ? "unavailable" : perAsset.size < eligibleCount ? "partial" : "complete",
    missingRates: [...missingRates],
    eligibleCount,
    closedPositionCount: closed.size,
    closedPositions: Array.from(closed.values()).flatMap(asset => {
      const pnl = perAsset.get(asset.id);
      return pnl ? [{ id: asset.id, name: asset.name, symbol: asset.symbol, currency: asset.currency,
        quoteDate: pnl.quoteDate, pnlBase: pnl.todayPnLBase }] : [];
    }),
    perAsset,
    sessionDates: { cnHk: today, us: latestUsQuoteDate }
  };
}

/**
 * 从 asset_change 里提取每只股票的历史价格点。
 * 同一北京日若多次更新过 current_price，按实际变更时刻和 ID 取最后一条，
 * 而不是取当天最高价 —— sparkline 反映"收盘价"语义。
 */
export function listStockPriceHistory(
  assetIds: number[]
): Map<number, Array<{ date: string; price: number }>> {
  if (assetIds.length === 0) return new Map();
  const db = getDB();
  const ph = assetIds.map(() => "?").join(",");
  // 合并两个来源：stock_price_daily（自动刷新写入，永久保留）+ asset_change（手动编辑写入）。
  // 同一 (asset_id, date) 优先取 stock_price_daily（priority=1），其次取 asset_change（priority=2）。
  const rows = db
    .prepare(
      `WITH manual_prices AS (
         SELECT asset_id,
                date(${CHANGE_INSTANT}, '+8 hours') AS date,
                ${CHANGE_INSTANT} AS changed_at,
                id,
                CAST(CASE WHEN json_valid(field_changes) THEN json_extract(field_changes, '$.current_price.to') END AS REAL) AS price
         FROM asset_change
         WHERE asset_id IN (${ph}) AND action = 'update'
       )
       SELECT asset_id, date, price FROM (
         SELECT asset_id, date, price,
                ROW_NUMBER() OVER (
                  PARTITION BY asset_id, date
                  ORDER BY priority ASC, changed_at DESC, id DESC
                ) AS rn
         FROM (
           SELECT asset_id, date, price, 1 AS priority, NULL AS changed_at, NULL AS id
           FROM stock_price_daily
           WHERE asset_id IN (${ph})
           UNION ALL
           SELECT asset_id, date, price, 2 AS priority, changed_at, id
           FROM manual_prices
           WHERE date IS NOT NULL AND price IS NOT NULL
         )
       )
       WHERE rn = 1
       ORDER BY asset_id, date ASC`
    )
    .all(...assetIds, ...assetIds) as Array<{ asset_id: number; date: string; price: number }>;

  const map = new Map<number, Array<{ date: string; price: number }>>();
  for (const r of rows) {
    if (!map.has(r.asset_id)) map.set(r.asset_id, []);
    map.get(r.asset_id)!.push({ date: r.date, price: r.price });
  }
  return map;
}

// 进程内节流：同一 baseCurrency 在 THROTTLE_MS 内只写一次快照，
// 避免 SSR / HMR 频繁刷新引发的大量 SQLite fsync，导致 dev server 挂死。
const SNAPSHOT_THROTTLE_MS = 30_000;
const lastSnapshotAt: Map<string, number> = (globalThis as any).__asset_snapshot_cache ??= new Map<
  string,
  number
>();

/**
 * 确保今日已有一条快照；若已存在则更新为最新值（幂等）。
 * 在每次访问 Dashboard / 保存资产时调用，保证曲线数据有今天的点。
 * 内部带 30s 节流，防止高频 SSR 触发频繁写入。
 */
export function ensureTodaySnapshot(baseCurrency: string) {
  const now = Date.now();
  const prev = lastSnapshotAt.get(baseCurrency) ?? 0;
  if (now - prev < SNAPSHOT_THROTTLE_MS) return;
  try {
    recordSnapshot(baseCurrency);
    lastSnapshotAt.set(baseCurrency, now);
  } catch {
    // 忽略错误（如汇率暂时缺失），Dashboard 仍可渲染
  }
}
