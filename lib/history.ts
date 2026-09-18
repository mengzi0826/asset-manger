import {
  getDB,
  type AssetRow,
  type AssetChange,
  type AssetValuationDaily,
  type PortfolioSnapshot
} from "./db";
import { convert, getRate } from "./fx";
import { computeAssetValue, valueAll } from "./valuation";
import { nowCn, todayCn } from "./time";
import { parseStockSymbol } from "./stocks";

/**
 * 从今天第一条「份额变更」记录反推「今日第一次改仓前」的持仓股数。
 *
 * 用途：今日盈亏按接口的 `change_amount`（相对昨收的单价涨跌）计算时，
 * 应乘以**今日日初总股数**（含当日已卖出的部分），否则减只会留在剩余持仓上计算，会漏掉已卖部分的当日浮盈。
 *
 * 算法：拉取今日内、按时间正序的 quantity 变更，从**当前股数**往回摊：`to` 与当前一致则 `from` 为上一档，重复直到最早一条。
 * 无今日份额变动时，日初股数 = 当前股数。
 *
 * 限制：若直接改库、或未走 API 导致无 `asset_change`，则无法还原，回落为当前股数。
 */
export function mapSecurityQuantityBeforeFirstEditToday(
  assetIds: number[],
  currentQtyById: Map<number, number>
): Map<number, number> {
  const out = new Map<number, number>();
  if (assetIds.length === 0) return out;
  const t = todayCn();
  const db = getDB();
  const ph = assetIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT asset_id, field_changes
       FROM asset_change
       WHERE asset_id IN (${ph})
         AND action = 'update'
         AND substr(created_at, 1, 10) = ?
         AND json_extract(field_changes, '$.quantity.from') IS NOT NULL
         AND json_extract(field_changes, '$.quantity.to') IS NOT NULL
       ORDER BY asset_id, created_at ASC, id ASC`
    )
    .all(...assetIds, t) as Array<{ asset_id: number; field_changes: string }>;

  const grouped = new Map<number, Array<string>>();
  for (const r of rows) {
    const list = grouped.get(r.asset_id) ?? [];
    list.push(r.field_changes);
    grouped.set(r.asset_id, list);
  }

  const EPS = 1e-6;
  for (const id of assetIds) {
    let q = currentQtyById.get(id) ?? 0;
    const list = grouped.get(id);
    if (!list || list.length === 0) {
      out.set(id, q);
      continue;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      try {
        const fc = JSON.parse(list[i]) as Record<string, { from?: unknown; to?: unknown }>;
        const diff = fc.quantity;
        if (!diff) continue;
        const toN = Number(diff.to);
        const fromN = Number(diff.from);
        if (!Number.isFinite(fromN) || !Number.isFinite(toN)) continue;
        if (Math.abs(toN - q) <= EPS) {
          q = fromN;
        } else {
          q = fromN;
        }
      } catch {
        /* skip malformed row */
      }
    }
    out.set(id, q);
  }
  return out;
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
    nowCn()
  );
}

export function listChanges(limit = 200): AssetChange[] {
  const db = getDB();
  return db
    .prepare("SELECT * FROM asset_change ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as AssetChange[];
}

export interface CashFlowEntry {
  id: number;
  type: "deposit" | "expense";
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
             END IN ('deposit', 'expense')
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
      if ((type !== "deposit" && type !== "expense") || !Number.isFinite(amount) || !reason) continue;
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

export interface FxImpactEntry {
  currency: string;
  previousNativeValue: number;
  currentNativeValue: number;
  previousRate: number | null;
  currentRate: number | null;
  baseValueChange: number;
  /** 对称分解：平均原币敞口 × 汇率变化。 */
  fxImpact: number | null;
  /** 对称分解：原币价值变化 × 平均汇率；其中仍包含交易、资金流和市场波动。 */
  nativeValueImpact: number | null;
  comparable: boolean;
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
      category_code: string;
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
  const hasPreviousValuation = rows.some((row) => row.date === from);
  const hasCurrentValuation = rows.some((row) => row.date === to);

  type Side = { present: boolean; native: number; base: number; rate: number | null };
  const buckets = new Map<string, { previous: Side; current: Side }>();
  const emptySide = (): Side => ({ present: false, native: 0, base: 0, rate: null });
  for (const row of rows) {
    const bucket = buckets.get(row.currency) ?? {
      previous: emptySide(),
      current: emptySide()
    };
    const side = row.date === from ? bucket.previous : bucket.current;
    const sign = row.category_code === "liability" ? -1 : 1;
    side.present = true;
    side.native += sign * row.native_value;
    side.base += sign * row.base_value;
    if (row.fx_rate != null) side.rate = row.fx_rate;
    buckets.set(row.currency, bucket);
  }

  let detailedBaseValueChange = 0;
  let totalFxImpact = 0;
  let totalNativeValueImpact = 0;
  let comparableBaseValueChange = 0;
  const byCurrency: FxImpactEntry[] = [];
  for (const [currency, { previous, current }] of buckets) {
    const baseValueChange = current.base - previous.base;
    detailedBaseValueChange += baseValueChange;
    const comparable =
      previous.present &&
      current.present &&
      previous.rate != null &&
      current.rate != null;
    let fxImpact: number | null = null;
    let nativeValueImpact: number | null = null;
    if (comparable) {
      fxImpact =
        ((previous.native + current.native) / 2) * (current.rate! - previous.rate!);
      nativeValueImpact =
        (current.native - previous.native) * ((previous.rate! + current.rate!) / 2);
      totalFxImpact += fxImpact;
      totalNativeValueImpact += nativeValueImpact;
      comparableBaseValueChange += baseValueChange;
    }
    byCurrency.push({
      currency,
      previousNativeValue: previous.native,
      currentNativeValue: current.native,
      previousRate: previous.rate,
      currentRate: current.rate,
      baseValueChange,
      fxImpact,
      nativeValueImpact,
      comparable
    });
  }
  byCurrency.sort((a, b) => Math.abs(b.baseValueChange) - Math.abs(a.baseValueChange));

  // 总净值优先取组合快照。旧库可能只有总快照而没有逐资产历史，差额会完整落入未归因。
  const totalBaseValueChange =
    previousSnapshot && currentSnapshot
      ? currentSnapshot.total_value - previousSnapshot.total_value
      : detailedBaseValueChange;

  return {
    baseCurrency: baseCurrency.toUpperCase(),
    from,
    to,
    hasPreviousSnapshot: previousSnapshot != null,
    hasCurrentSnapshot: currentSnapshot != null,
    hasPreviousValuation,
    hasCurrentValuation,
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
 * 最新的有效交易日。空日期不计入，且不同美股交易日不会混在同一次汇总中。
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
    /** Juhe 行情会话日 `YYYY-MM-DD` */
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
  const removed = getDB().prepare(`SELECT asset_id, snapshot FROM asset_change
    WHERE action = 'delete' AND substr(created_at, 1, 10) = ?
    ORDER BY id DESC`).all(today) as Array<{ asset_id: number; snapshot: string | null }>;
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
          item.changeQuoteDate != null &&
          item.changeQuoteDate <= today
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
 * 同一天若多次更新过 current_price，取**最后一次写入**（按 created_at, id 倒序），
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
  // asset_change 先在子查询内按 id DESC 去重（同天多次编辑取最后一次），再参与 UNION。
  const rows = db
    .prepare(
      `SELECT asset_id, date, price FROM (
         SELECT asset_id, date, price,
                ROW_NUMBER() OVER (
                  PARTITION BY asset_id, date
                  ORDER BY priority ASC
                ) AS rn
         FROM (
           SELECT asset_id, date, price, 1 AS priority
           FROM stock_price_daily
           WHERE asset_id IN (${ph})
           UNION ALL
           SELECT asset_id,
                  substr(created_at, 1, 10) AS date,
                  CAST(json_extract(field_changes, '$.current_price.to') AS REAL) AS price,
                  2 AS priority
           FROM (
             SELECT asset_id, created_at,
                    field_changes,
                    ROW_NUMBER() OVER (
                      PARTITION BY asset_id, substr(created_at, 1, 10)
                      ORDER BY id DESC
                    ) AS rn2
             FROM asset_change
             WHERE asset_id IN (${ph})
               AND action = 'update'
               AND json_extract(field_changes, '$.current_price.to') IS NOT NULL
           )
           WHERE rn2 = 1
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
