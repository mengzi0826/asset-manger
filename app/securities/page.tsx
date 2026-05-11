import Link from "next/link";
import { ExternalLink, TrendingUp } from "lucide-react";
import { getSetting } from "@/lib/db";
import { convert, kickoffRatesRefresh } from "@/lib/fx";
import { kickoffStockPricesRefresh, parseStockSymbol } from "@/lib/stocks";
import { todayCn } from "@/lib/time";
import { valueAll } from "@/lib/valuation";
import {
  computeTodayStockPnL,
  listSecuritiesBreakdown,
  listStockPriceHistory,
  mapSecurityQuantityBeforeFirstEditToday,
  type TodayPnLEntry
} from "@/lib/history";
import {
  SecuritiesPanel,
  type SecuritiesPanelData,
  type SecuritiesPosition
} from "@/components/charts/SecuritiesChart";
import { formatCompact, formatMoney, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

const compact = (v: number) => formatCompact(v, { digits: 2 });

export default async function SecuritiesPage() {
  kickoffRatesRefresh();
  kickoffStockPricesRefresh();

  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const valuation = valueAll(baseCurrency);

  const secItems = valuation.items.filter((a) => a.category_code === "securities");
  const secAssetIds = secItems.map((a) => a.id);
  const securitiesHistory = listSecuritiesBreakdown(baseCurrency, 365);
  const stockPriceHistory = listStockPriceHistory(secAssetIds);

  // 今日盈亏：仅当 change_quote_date === 今天 时用 change_amount / change_percent（见 lib/history.ts）
  const todayPnL = computeTodayStockPnL(
    secItems.map((a) => ({
      id: a.id,
      currency: a.currency,
      quantity: a.quantity ?? 0,
      currentPrice: a.current_price,
      changeAmount: a.change_amount,
      changePercent: a.change_percent,
      changeQuoteDate: a.change_quote_date
    })),
    baseCurrency
  );

  const qtyDayStartById = mapSecurityQuantityBeforeFirstEditToday(
    secAssetIds,
    new Map(secItems.map((a) => [a.id, a.quantity ?? 0]))
  );

  let secTotalCost = 0;
  let secUnrealized = 0;

  const secPositions: SecuritiesPosition[] = secItems.map((a) => {
    const pnlNative =
      a.unit_cost != null && a.current_price != null
        ? (a.current_price - a.unit_cost) * (a.quantity ?? 0)
        : null;
    const pnlPct =
      a.unit_cost != null && a.unit_cost > 0 && a.current_price != null
        ? (a.current_price - a.unit_cost) / a.unit_cost
        : null;
    const fxRatio = a.native_value !== 0 ? a.base_value / a.native_value : 1;
    if (a.unit_cost != null) {
      secTotalCost += a.unit_cost * (a.quantity ?? 0) * fxRatio;
    }
    if (pnlNative != null) {
      secUnrealized += pnlNative * fxRatio;
    }
    const pnlBase = pnlNative != null ? pnlNative * fxRatio : null;
    const stockInfo = parseStockSymbol(a.symbol);
    const todayEntry = todayPnL.perAsset.get(a.id);
    return {
      id: a.id,
      name: a.name,
      symbol: a.symbol ?? null,
      market: stockInfo?.marketName ?? null,
      currency: a.currency,
      currentPrice: a.current_price,
      unitCost: a.unit_cost,
      quantity: a.quantity ?? 0,
      baseValue: a.base_value,
      pnlNative,
      pnlBase,
      pnlPct,
      todayChangePct: todayEntry?.todayChangePct ?? null,
      todayPnLBase: todayEntry?.todayPnLBase ?? null,
      priceHistory: stockPriceHistory.get(a.id) ?? []
    };
  });

  const totalValue = valuation.byCategory.securities ?? 0;
  const pnlUp = secUnrealized >= 0;
  const secHoldingsWithQty = secItems.filter((a) => (a.quantity ?? 0) > 0);
  const hasSecuritiesForTodayKpi = secHoldingsWithQty.length > 0;
  const todayPnLValue = todayPnL.totalBase;
  const todayUp = todayPnLValue > 0;
  const contributingCount = todayPnL.perAsset.size;

  // 按固定市场顺序分组
  const MARKET_ORDER = ["沪深 A 股", "港股", "美股", "其他"] as const;
  const byMarket: Record<string, { count: number; value: number }> = {};
  for (const p of secPositions) {
    const m = p.market ?? "其他";
    (byMarket[m] ??= { count: 0, value: 0 });
    byMarket[m].count += 1;
    byMarket[m].value += p.baseValue;
  }
  const marketStats = MARKET_ORDER.map((m) => ({ market: m, ...( byMarket[m] ?? { count: 0, value: 0 }) }))
    .filter((s) => s.count > 0);

  const pnlHistory = buildPnLHistory(
    secPositions,
    stockPriceHistory,
    todayPnL.perAsset,
    baseCurrency,
    qtyDayStartById
  );

  const panelData: SecuritiesPanelData = {
    totalValue,
    totalCost: secTotalCost,
    unrealizedPnL: secUnrealized,
    positionCount: secItems.length,
    currency: baseCurrency,
    securitiesHistory,
    pnlHistory,
    positions: secPositions
  };

  const hasPositions = secItems.length > 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink-900">证券</h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            股票 / ETF / LOF · 实时价格 + 历史走势
          </p>
        </div>
        <Link
          href="/assets/new"
          className="btn-primary"
        >
          新增持仓
        </Link>
      </div>

      {!hasPositions ? (
        <div className="card">
          <div className="card-body flex flex-col items-center gap-3 py-14 text-center">
            <TrendingUp className="h-8 w-8 text-ink-300" />
            <div>
              <div className="text-[15px] font-semibold text-ink-900">还没有证券持仓</div>
              <div className="mt-1 text-[13px] text-ink-500">
                在「持仓」中为证券类账户添加资产，或直接点击上方新增按钮
              </div>
            </div>
            <Link href="/assets/new" className="btn-outline mt-2">
              立即添加
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* KPI 汇总 */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
            <KpiCard
              label="证券总市值"
              value={formatMoney(totalValue, baseCurrency, 0)}
              sub={`${secItems.length} 只持仓`}
            />
            <KpiCard
              label="今日盈亏"
              value={
                hasSecuritiesForTodayKpi
                  ? (todayPnLValue > 0 ? "+" : "") + formatMoney(todayPnLValue, baseCurrency, 0)
                  : "—"
              }
              sub={hasSecuritiesForTodayKpi ? `${contributingCount} 只` : undefined}
              gain={todayUp}
              hasData={hasSecuritiesForTodayKpi && contributingCount > 0 && todayPnLValue !== 0}
            />
            <KpiCard
              label="浮动盈亏"
              value={(pnlUp ? "+" : "") + formatMoney(secUnrealized, baseCurrency, 0)}
              sub={
                secTotalCost > 0
                  ? `成本回报 ${formatPercent(secUnrealized / secTotalCost, 2)}`
                  : "暂无成本数据"
              }
              gain={pnlUp}
              hasData={secUnrealized !== 0}
            />
            {marketStats.map((s) => (
              <KpiCard
                key={s.market}
                label={s.market}
                value={compact(s.value)}
                sub={`${s.count} 只 · ${baseCurrency}`}
              />
            ))}
          </div>

          {/* 上排：总市值走势 + 浮动盈亏走势 左右分布、等宽等高 */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-stretch">
            <section className="card flex flex-col">
              <div className="card-header">
                <div className="card-title">证券总市值走势</div>
                <span className="chip tabular">以 {baseCurrency} 结算</span>
              </div>
              <div className="card-body flex-1">
                <SecuritiesTrendSection data={panelData} />
              </div>
            </section>

            <section className="card flex flex-col">
              <div className="card-header">
                <div className="card-title">浮动盈亏走势</div>
                <span className="text-[11px] text-ink-400">
                  以 {baseCurrency} 结算 · 基于价格刷新记录
                </span>
              </div>
              <div className="card-body flex-1">
                <SecuritiesPnLSection data={panelData} />
              </div>
            </section>
          </div>

          {/* 下排：持仓明细整行铺开 */}
          <section className="card">
            <div className="card-header">
              <div className="card-title">持仓明细</div>
              <Link
                href="/assets"
                className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-gold-500"
              >
                编辑
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="card-body">
              <SecuritiesDetailSection data={panelData} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ── 页面专用小卡片 ── */

function KpiCard({
  label,
  value,
  sub,
  gain,
  hasData
}: {
  label: string;
  value: string;
  sub?: string;
  gain?: boolean;
  hasData?: boolean;
}) {
  const colored =
    gain === undefined || hasData === false
      ? "text-ink-900"
      : gain
      ? "text-gain-700"
      : "text-loss-700";
  return (
    <div className="card">
      <div className="card-body py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          {label}
        </div>
        <div className={`mt-1.5 text-[20px] font-bold tabular leading-none ${colored}`}>
          {value}
        </div>
        {sub && (
          <div className="mt-1 text-[11px] text-ink-400">{sub}</div>
        )}
      </div>
    </div>
  );
}

/* ── 三个专区：把 SecuritiesPanel 的三个区域分别单独渲染 ── */

/**
 * 总市值走势折线图
 * 直接复用 SecuritiesPanel 内部的数据结构，但在独立卡片里展示
 */
function SecuritiesTrendSection({ data }: { data: SecuritiesPanelData }) {
  const trendOnly: SecuritiesPanelData = {
    ...data,
    positions: [],
    pnlHistory: []
  };
  return <SecuritiesPanel data={trendOnly} mode="trend" />;
}

function SecuritiesPnLSection({ data }: { data: SecuritiesPanelData }) {
  const pnlOnly: SecuritiesPanelData = {
    ...data,
    positions: [],
    securitiesHistory: []
  };
  return <SecuritiesPanel data={pnlOnly} mode="pnl" />;
}

function SecuritiesDetailSection({ data }: { data: SecuritiesPanelData }) {
  const detailOnly: SecuritiesPanelData = {
    ...data,
    securitiesHistory: [],
    pnlHistory: []
  };
  return <SecuritiesPanel data={detailOnly} mode="detail" />;
}

/* ─────────────────── 逐日浮动盈亏重建 ─────────────────── */

/** 计算 ISO 日期字符串的「前一天」（按字面日期推算，不考虑时区） */
function isoMinusOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * 重建「浮动盈亏」逐日序列。
 *
 * 关键约束：曲线最后一段（昨日 → 今日）的差值必须严格等于 KPI 的「今日盈亏」。
 *
 * 算法：
 *  1. 收集所有「严格早于今天」的 priceHistory 日期，加上昨日、今日。
 *  2. 对每只持仓：
 *     - 今天的价格 = currentPrice（与持仓明细一致）。
 *     - 昨天的价格 = currentPrice − todayPriceChange（即接口返回的「昨收」）。
 *       todayPriceChange 来自股票行情接口的 change_amount，所以严格保证差值匹配 KPI。
 *     - 昨天以前：若无 priceHistory，直接沿用「昨收」做平线（贡献恒定的实际盈亏）；
 *       若有 priceHistory，则按记录逐日推进价格。
 *  3. 折算到基准货币累加。
 */
function buildPnLHistory(
  positions: SecuritiesPosition[],
  priceHistory: Map<number, Array<{ date: string; price: number }>>,
  todayPnLByAsset: Map<number, TodayPnLEntry>,
  baseCurrency: string,
  /** 今日日初股数（含已卖出）；昨日/今日 P&L 用此股数才能与「今日盈亏」KPI 一致 */
  qtyDayStartById: Map<number, number>
): Array<{ date: string; pnl: number }> {
  const todayIso = todayCn();
  const yesterdayIso = isoMinusOneDay(todayIso);

  // 只收集「严格早于今天」的历史日期，避免今日 priceHistory 记录干扰今天的强制赋值
  const allDates = new Set<string>();
  for (const [, h] of priceHistory) {
    for (const { date } of h) {
      if (date < todayIso) allDates.add(date);
    }
  }
  allDates.add(yesterdayIso);
  allDates.add(todayIso);

  const sortedDates = [...allDates].sort();

  // 按资产整理：仅保留「早于今天」的 priceHistory 用于推进
  const byAsset = new Map<number, Array<{ date: string; price: number }>>();
  for (const [id, h] of priceHistory) {
    const past = h.filter((r) => r.date < todayIso);
    if (past.length > 0) {
      byAsset.set(id, past.sort((a, b) => a.date.localeCompare(b.date)));
    }
  }

  // 计算每只持仓的「昨收价」基准（用于昨天和无历史时的常量基线）
  const yesterdayClose = new Map<number, number>();
  for (const pos of positions) {
    if (pos.unitCost == null) continue;
    const entry = todayPnLByAsset.get(pos.id);
    if (entry && pos.currentPrice != null) {
      yesterdayClose.set(pos.id, pos.currentPrice - entry.todayPriceChange);
    } else if (pos.currentPrice != null) {
      // 没有 change_amount → 昨收近似为现价（这只股今日不参与差值贡献）
      yesterdayClose.set(pos.id, pos.currentPrice);
    } else {
      yesterdayClose.set(pos.id, pos.unitCost);
    }
  }

  // 维护每只持仓在「昨天以前」的逐日价格游标。
  // 初始：有 priceHistory → 从 unitCost 出发（首个历史点出现前 P&L=0）；
  //       无 priceHistory → 直接用昨收（曲线表现为常量）。
  const runningPrice = new Map<number, number>();
  for (const pos of positions) {
    if (pos.unitCost == null) continue;
    runningPrice.set(
      pos.id,
      byAsset.has(pos.id) ? pos.unitCost : (yesterdayClose.get(pos.id) ?? pos.unitCost)
    );
  }
  const cursors = new Map<number, number>();
  for (const [id] of byAsset) cursors.set(id, 0);

  const result: Array<{ date: string; pnl: number }> = [];

  for (const date of sortedDates) {
    // 仅当 date < 今天时才推进 priceHistory（昨天 / 今天用各自的强制规则）
    if (date < yesterdayIso) {
      for (const [id, history] of byAsset) {
        let cur = cursors.get(id) ?? 0;
        while (cur < history.length && history[cur].date <= date) {
          runningPrice.set(id, history[cur].price);
          cur++;
        }
        cursors.set(id, cur);
      }
    }

    let pnl = 0;
    for (const pos of positions) {
      if (pos.unitCost == null) continue;
      const qtyEff =
        date === todayIso || date === yesterdayIso
          ? qtyDayStartById.get(pos.id) ?? pos.quantity
          : pos.quantity;
      let price: number;
      if (date === todayIso) {
        price = pos.currentPrice ?? runningPrice.get(pos.id) ?? pos.unitCost;
      } else if (date === yesterdayIso) {
        price = yesterdayClose.get(pos.id) ?? pos.unitCost;
      } else {
        price = runningPrice.get(pos.id) ?? pos.unitCost;
      }
      const pnlNative = (price - pos.unitCost) * qtyEff;
      pnl += convert(pnlNative, pos.currency, baseCurrency) ?? 0;
    }
    result.push({ date, pnl: Math.round(pnl) });
  }

  return result;
}
