import { getDB, type AssetRow, type AssetChange, type PortfolioSnapshot } from "./db";
import { convert } from "./fx";
import { computeAssetValue, valueAll } from "./valuation";
import { nowCn, todayCn } from "./time";

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

/** 单只股票的「今日盈亏」分项数据（来自股票行情接口落库的当日涨跌字段） */
export interface TodayPnLEntry {
  assetId: number;
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
}) {
  const { action, before, after } = params;
  const db = getDB();
  const target = after ?? before;
  if (!target) return;

  let fieldChanges: Record<string, { from: unknown; to: unknown }> | null = null;
  if (action === "update" && before && after) {
    fieldChanges = {};
    const keys: (keyof AssetRow)[] = [
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
    if (Object.keys(fieldChanges).length === 0) return;
  }

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
    fieldChanges ? JSON.stringify(fieldChanges) : null,
    JSON.stringify(target),
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

export function recordSnapshot(baseCurrency: string): PortfolioSnapshot {
  const db = getDB();
  const { total, byCategory } = valueAll(baseCurrency);
  const today = todayCn();
  db.prepare(
    `INSERT INTO portfolio_snapshot (date, base_currency, total_value, breakdown, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date, base_currency) DO UPDATE SET
       total_value = excluded.total_value,
       breakdown = excluded.breakdown`
  ).run(today, baseCurrency, total, JSON.stringify(byCategory), nowCn());
  return db
    .prepare("SELECT * FROM portfolio_snapshot WHERE date = ? AND base_currency = ?")
    .get(today, baseCurrency) as PortfolioSnapshot;
}

export function listSnapshots(baseCurrency: string, days = 365): PortfolioSnapshot[] {
  const db = getDB();
  return db
    .prepare(
      `SELECT * FROM portfolio_snapshot
       WHERE base_currency = ?
       ORDER BY date ASC
       LIMIT ?`
    )
    .all(baseCurrency, days) as PortfolioSnapshot[];
}

/** 从组合快照里提取证券大类的历史总值曲线 */
export function listSecuritiesBreakdown(
  baseCurrency: string,
  days = 365
): Array<{ date: string; value: number }> {
  const db = getDB();
  return (
    db
      .prepare(
        `SELECT date,
                COALESCE(CAST(json_extract(breakdown, '$.securities') AS REAL), 0) AS value
         FROM portfolio_snapshot
         WHERE base_currency = ?
         ORDER BY date ASC
         LIMIT ?`
      )
      .all(baseCurrency, days) as Array<{ date: string; value: number }>
  ).filter((r) => r.value > 0);
}

/**
 * 今日盈亏（证券）：仅 `change_quote_date === todayCn()` 的标的参与。
 * 单价涨跌来自 `change_amount` / `change_percent`；股数用 `mapSecurityQuantityBeforeFirstEditToday`（当日减仓按日初股数）。
 */
export function computeTodayStockPnL(
  items: Array<{
    id: number;
    currency: string;
    quantity: number;
    currentPrice: number | null;
    changeAmount: number | null;
    changePercent: number | null;
    /** Juhe 行情会话日 `YYYY-MM-DD`（北京）；≠ 今天则不参与今日盈亏 */
    changeQuoteDate?: string | null;
  }>,
  baseCurrency: string
): { totalBase: number; perAsset: Map<number, TodayPnLEntry> } {
  const perAsset = new Map<number, TodayPnLEntry>();
  let totalBase = 0;

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

    if (item.changeQuoteDate !== todayCn()) {
      continue;
    }

    let todayPriceChange: number | null = null;
    let todayChangePct: number | null = null;

    if (item.changeAmount != null && Number.isFinite(item.changeAmount)) {
      todayPriceChange = item.changeAmount;
      todayChangePct =
        item.changePercent != null && Number.isFinite(item.changePercent)
          ? item.changePercent
          : item.currentPrice != null && item.currentPrice - item.changeAmount > 0
            ? item.changeAmount / (item.currentPrice - item.changeAmount)
            : null;
    } else if (
      item.changePercent != null &&
      Number.isFinite(item.changePercent) &&
      item.currentPrice != null
    ) {
      // current = prev * (1 + pct) ⇒ prev = current / (1 + pct) ⇒ change = current - prev
      const denom = 1 + item.changePercent;
      if (denom !== 0) {
        const prev = item.currentPrice / denom;
        todayPriceChange = item.currentPrice - prev;
        todayChangePct = item.changePercent;
      }
    }

    if (todayPriceChange == null) continue;

    const todayPnLNative = todayPriceChange * qtyDayStart;
    const todayPnLBase = convert(todayPnLNative, item.currency, baseCurrency) ?? 0;
    perAsset.set(item.id, {
      assetId: item.id,
      todayPriceChange,
      todayChangePct: todayChangePct ?? 0,
      todayPnLNative,
      todayPnLBase
    });
    totalBase += todayPnLBase;
  }

  return { totalBase, perAsset };
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
  const rows = db
    .prepare(
      `SELECT asset_id, date, price FROM (
         SELECT asset_id,
                substr(created_at, 1, 10) AS date,
                CAST(json_extract(field_changes, '$.current_price.to') AS REAL) AS price,
                ROW_NUMBER() OVER (
                  PARTITION BY asset_id, substr(created_at, 1, 10)
                  ORDER BY created_at DESC, id DESC
                ) AS rn
         FROM asset_change
         WHERE asset_id IN (${ph})
           AND action = 'update'
           AND json_extract(field_changes, '$.current_price.to') IS NOT NULL
       )
       WHERE rn = 1
       ORDER BY asset_id, date ASC`
    )
    .all(...assetIds) as Array<{ asset_id: number; date: string; price: number }>;

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
