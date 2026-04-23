import Link from "next/link";
import { ExternalLink, TrendingUp } from "lucide-react";
import { getSetting } from "@/lib/db";
import { ensureRates, convert } from "@/lib/fx";
import { ensureStockPrices, parseStockSymbol } from "@/lib/stocks";
import { valueAll } from "@/lib/valuation";
import {
  listSecuritiesBreakdown,
  listStockPriceHistory
} from "@/lib/history";
import {
  SecuritiesPanel,
  type SecuritiesPanelData,
  type SecuritiesPosition
} from "@/components/charts/SecuritiesChart";
import { formatMoney, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(2) + " 亿";
  if (abs >= 1e4) return (v / 1e4).toFixed(2) + " 万";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default async function SecuritiesPage() {
  await ensureRates();
  await ensureStockPrices();

  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const valuation = valueAll(baseCurrency);

  const secItems = valuation.items.filter((a) => a.category_code === "securities");
  const secAssetIds = secItems.map((a) => a.id);
  const securitiesHistory = listSecuritiesBreakdown(baseCurrency, 365);
  const stockPriceHistory = listStockPriceHistory(secAssetIds);

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
    const stockInfo = parseStockSymbol(a.symbol);
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
      pnlPct,
      priceHistory: stockPriceHistory.get(a.id) ?? []
    };
  });

  const totalValue = valuation.byCategory.securities ?? 0;
  const pnlUp = secUnrealized >= 0;

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

  const pnlHistory = buildPnLHistory(secPositions, stockPriceHistory, baseCurrency);

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
            <KpiCard
              label="证券总市值"
              value={formatMoney(totalValue, baseCurrency, 0)}
              sub={`${secItems.length} 只持仓`}
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

          {/* 主看板 */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {/* 左侧：走势 + 盈亏排行 */}
            <div className="xl:col-span-2 space-y-6">
              {/* 总市值走势 */}
              <section className="card">
                <div className="card-header">
                  <div className="card-title">证券总市值走势</div>
                  <span className="chip tabular">以 {baseCurrency} 结算</span>
                </div>
                <div className="card-body">
                  <SecuritiesTrendSection data={panelData} />
                </div>
              </section>

              {/* 浮动盈亏走势 */}
              <section className="card">
                <div className="card-header">
                  <div className="card-title">浮动盈亏走势</div>
                  <span className="text-[11px] text-ink-400">以 {baseCurrency} 结算 · 基于价格刷新记录</span>
                </div>
                <div className="card-body">
                  <SecuritiesPnLSection data={panelData} />
                </div>
              </section>
            </div>

            {/* 右侧：持仓明细 */}
            <section className="card xl:col-span-1">
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
              <div className="card-body overflow-y-auto" style={{ maxHeight: 620 }}>
                <SecuritiesDetailSection data={panelData} />
              </div>
            </section>
          </div>
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

/**
 * 根据 asset_change 里的历史价格记录，逐日重建"浮动盈亏"序列。
 *
 * 算法：
 *  1. 收集所有出现过价格更新的日期（去重、升序）。
 *  2. 对每个日期，对每只有 unitCost 的持仓：
 *     取该日期（含之前最近一次）已知价格，若无则用 unitCost 作为起始基准。
 *     P&L_native = (price - unitCost) * quantity
 *  3. 折算到基准货币后累加。
 */
function buildPnLHistory(
  positions: SecuritiesPosition[],
  priceHistory: Map<number, Array<{ date: string; price: number }>>,
  baseCurrency: string
): Array<{ date: string; pnl: number }> {
  // 收集所有日期
  const allDates = new Set<string>();
  for (const [, h] of priceHistory) for (const { date } of h) allDates.add(date);
  if (allDates.size === 0) return [];

  const sortedDates = [...allDates].sort();

  // 按资产整理：date -> price 的有序记录
  const byAsset = new Map<number, Array<{ date: string; price: number }>>();
  for (const [id, h] of priceHistory) byAsset.set(id, [...h].sort((a, b) => a.date.localeCompare(b.date)));

  // 维护每只股票当前最新价格，初始为 unitCost（P&L 起点 = 0）
  const latestPrice = new Map<number, number>();
  for (const pos of positions) {
    if (pos.unitCost != null) latestPrice.set(pos.id, pos.unitCost);
  }

  // 每个日期的游标（指向下一条未消费的价格记录）
  const cursors = new Map<number, number>();
  for (const [id] of byAsset) cursors.set(id, 0);

  const result: Array<{ date: string; pnl: number }> = [];

  for (const date of sortedDates) {
    // 推进每只股票到当天（≤ date）的最新价格
    for (const [id, history] of byAsset) {
      let cur = cursors.get(id) ?? 0;
      while (cur < history.length && history[cur].date <= date) {
        latestPrice.set(id, history[cur].price);
        cur++;
      }
      cursors.set(id, cur);
    }

    // 计算当日总盈亏
    let pnl = 0;
    for (const pos of positions) {
      if (pos.unitCost == null) continue;
      const price = latestPrice.get(pos.id) ?? pos.unitCost;
      const pnlNative = (price - pos.unitCost) * pos.quantity;
      pnl += convert(pnlNative, pos.currency, baseCurrency) ?? 0;
    }
    result.push({ date, pnl: Math.round(pnl) });
  }

  return result;
}
