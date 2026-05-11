"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine
} from "recharts";
import { useTheme } from "@/lib/useTheme";
import { formatCompact } from "@/lib/utils";

/* ─────────────── constants ─────────────── */

/** 市场显示顺序与标签 */
const MARKET_ORDER = ["沪深 A 股", "港股", "美股", "其他"] as const;
type MarketLabel = (typeof MARKET_ORDER)[number];

function marketLabel(market: string | null): MarketLabel {
  if (!market) return "其他";
  if (market === "沪深 A 股") return "沪深 A 股";
  if (market === "港股") return "港股";
  if (market === "美股") return "美股";
  return "其他";
}

/* ─────────────── types ─────────────── */

export interface SecuritiesPosition {
  id: number;
  name: string;
  symbol: string | null;
  market: string | null;
  currency: string;
  currentPrice: number | null;
  unitCost: number | null;
  quantity: number;
  baseValue: number;
  /** 累计浮动盈亏（原币） */
  pnlNative: number | null;
  /** 累计浮动盈亏（基准币，已折算） */
  pnlBase: number | null;
  /** 累计浮动盈亏率 */
  pnlPct: number | null;
  /** 今日单价涨跌幅 */
  todayChangePct: number | null;
  /** 今日盈亏（基准币） */
  todayPnLBase: number | null;
  /** price history from asset_change: [{date, price}] */
  priceHistory: Array<{ date: string; price: number }>;
}

export interface SecuritiesPanelData {
  totalValue: number;
  totalCost: number;
  unrealizedPnL: number;
  positionCount: number;
  currency: string;
  securitiesHistory: Array<{ date: string; value: number }>;
  /** 每日浮动盈亏序列（由 asset_change 价格记录重建） */
  pnlHistory: Array<{ date: string; pnl: number }>;
  positions: SecuritiesPosition[];
}

/* ─────────────── palette ─────────────── */

function usePalette(isDark: boolean) {
  return isDark
    ? {
        grid: "#1E293B",
        axisLine: "#1E293B",
        tick: "#64748B",
        tooltipBg: "#1E293B",
        tooltipBorder: "#334155",
        tooltipText: "#F1F5F9",
        tooltipLabel: "#94A3B8",
        gainStroke: "#F87171",
        gainFill: "#F87171",
        lossStroke: "#34D399",
        lossFill: "#34D399",
        neutralStroke: "#60A5FA",
        activeDotStroke: "#0B1020",
        barBg: "#1E293B"
      }
    : {
        grid: "#E7E4D9",
        axisLine: "#E7E4D9",
        tick: "#7A8699",
        tooltipBg: "#0F172A",
        tooltipBorder: "#1E293B",
        tooltipText: "#F8FAFC",
        tooltipLabel: "#CBD5E1",
        gainStroke: "#DC2626",
        gainFill: "#DC2626",
        lossStroke: "#059669",
        lossFill: "#059669",
        neutralStroke: "#3B82F6",
        activeDotStroke: "#FFFFFF",
        barBg: "#F1F5F9"
      };
}

/* ─────────────── formatters ─────────────── */

/** 紧凑数值：图表轴 / 行内紧凑展示用，全项目统一在 lib/utils.ts。 */
const compact = (v: number) => formatCompact(v, { digits: 1, useK: true });

function pctStr(v: number, decimals = 1): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
}

/* ─────────────── MiniSparkline ─────────────── */

function MiniSparkline({
  history,
  unitCost,
  currentPrice,
  isDark
}: {
  history: Array<{ date: string; price: number }>;
  unitCost: number | null;
  currentPrice: number | null;
  isDark: boolean;
}) {
  const pal = usePalette(isDark);

  // 构建 sparkline 数据：若有历史则用历史；否则用 cost → current 两点
  let pts: Array<{ v: number }>;
  if (history.length >= 2) {
    pts = history.map((h) => ({ v: h.price }));
  } else if (unitCost != null && currentPrice != null) {
    pts = [{ v: unitCost }, { v: currentPrice }];
  } else if (currentPrice != null) {
    pts = [{ v: currentPrice }];
  } else {
    return <div className="h-8 w-14 opacity-30 text-[10px] text-ink-400 flex items-center">—</div>;
  }

  if (pts.length < 2) return <div className="h-8 w-14" />;

  const first = pts[0].v;
  const last = pts[pts.length - 1].v;
  const up = last >= first;
  const stroke = up ? pal.gainStroke : pal.lossStroke;

  return (
    <div className="h-8 w-14 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pts} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
          <defs>
            <linearGradient id={`spark-${up ? "gain" : "loss"}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#spark-${up ? "gain" : "loss"})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────── TotalTrendChart ─────────────── */

function TotalTrendChart({
  data,
  currency,
  isDark,
  tall = false
}: {
  data: Array<{ date: string; value: number }>;
  currency: string;
  isDark: boolean;
  tall?: boolean;
}) {
  const pal = usePalette(isDark);

  const h = tall ? 200 : 120;

  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-ink-400"
        style={{ height: h }}
      >
        历史快照点不足，修改资产后将自动记录
      </div>
    );
  }

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const up = last >= first;
  const stroke = up ? pal.gainStroke : pal.lossStroke;

  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="secTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={isDark ? 0.3 : 0.2} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke={pal.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: pal.tick, fontFamily: "JetBrains Mono" }}
            tickLine={false}
            axisLine={{ stroke: pal.axisLine }}
            minTickGap={32}
          />
          <YAxis
            tick={{ fontSize: 10, fill: pal.tick, fontFamily: "JetBrains Mono" }}
            tickFormatter={compact}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ReferenceLine y={first} stroke={pal.grid} strokeDasharray="3 3" />
          <Tooltip
            wrapperStyle={{ outline: "none" }}
            contentStyle={{
              background: pal.tooltipBg,
              border: `1px solid ${pal.tooltipBorder}`,
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 11,
              color: pal.tooltipText,
              fontFamily: "JetBrains Mono, monospace"
            }}
            labelStyle={{ color: pal.tooltipLabel, fontSize: 10 }}
            formatter={(v: number) => [`${compact(v)} ${currency}`, "证券市值"]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.8}
            fill="url(#secTotal)"
            activeDot={{ r: 3, stroke: pal.activeDotStroke, strokeWidth: 2, fill: stroke }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────── PnLTrendChart ─────────────── */

function PnLTrendChart({
  data,
  currency,
  isDark,
  tall = false
}: {
  data: Array<{ date: string; pnl: number }>;
  currency: string;
  isDark: boolean;
  tall?: boolean;
}) {
  const pal = usePalette(isDark);
  const h = tall ? 200 : 160;

  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-ink-400"
        style={{ height: h }}
      >
        暂无盈亏历史（需配置买入价，且当前价至少刷新过一次）
      </div>
    );
  }

  // 为每个点标注颜色方向（用于渐变 id）
  const last = data[data.length - 1].pnl;
  const up = last >= 0;
  const stroke = up ? pal.gainStroke : pal.lossStroke;
  const gradId = `pnl-grad-${up ? "gain" : "loss"}`;

  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={isDark ? 0.3 : 0.2} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke={pal.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: pal.tick, fontFamily: "JetBrains Mono" }}
            tickLine={false}
            axisLine={{ stroke: pal.axisLine }}
            minTickGap={32}
          />
          <YAxis
            tick={{ fontSize: 10, fill: pal.tick, fontFamily: "JetBrains Mono" }}
            tickFormatter={(v) => (v >= 0 ? "+" : "") + compact(v)}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          {/* 零轴基准线 */}
          <ReferenceLine y={0} stroke={pal.axisLine} strokeDasharray="3 3" strokeWidth={1.2} />
          <Tooltip
            wrapperStyle={{ outline: "none" }}
            contentStyle={{
              background: pal.tooltipBg,
              border: `1px solid ${pal.tooltipBorder}`,
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 11,
              color: pal.tooltipText,
              fontFamily: "JetBrains Mono, monospace"
            }}
            labelStyle={{ color: pal.tooltipLabel, fontSize: 10 }}
            formatter={(v: number) => [
              `${v >= 0 ? "+" : ""}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`,
              "浮动盈亏"
            ]}
          />
          <Area
            type="monotone"
            dataKey="pnl"
            stroke={stroke}
            strokeWidth={1.8}
            fill={`url(#${gradId})`}
            activeDot={{ r: 3, stroke: pal.activeDotStroke, strokeWidth: 2, fill: stroke }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────── Main export ─────────────── */

/**
 * mode:
 *  "all"    – 渲染全部区块（总览 mini 面板使用）
 *  "trend"  – 仅总市值走势折线图（证券独立页使用）
 *  "pnl"    – 仅盈亏排行图（证券独立页使用）
 *  "detail" – 仅持仓明细列表 + sparkline（证券独立页使用）
 */
export type SecuritiesPanelMode = "all" | "trend" | "pnl" | "detail";

export function SecuritiesPanel({
  data,
  mode = "all"
}: {
  data: SecuritiesPanelData;
  mode?: SecuritiesPanelMode;
}) {
  const isDark = useTheme() === "dark";
  const pal = usePalette(isDark);

  const {
    totalValue,
    unrealizedPnL,
    positionCount,
    currency,
    securitiesHistory,
    pnlHistory,
    positions
  } = data;
  const pnlUp = unrealizedPnL >= 0;

  const pnlPosCount = positions.filter((p) => (p.pnlPct ?? 0) > 0).length;
  const pnlNegCount = positions.filter((p) => (p.pnlPct ?? 0) < 0).length;

  const ranked = [...positions].sort((a, b) => b.baseValue - a.baseValue);

  const showKpi = mode === "all";
  const showTrend = mode === "all" || mode === "trend";
  const showPnl = mode === "all" || mode === "pnl";
  const showDetail = mode === "all" || mode === "detail";

  return (
    <div className="flex flex-col gap-4">
      {/* ── KPI 摘要（仅 all 模式） ── */}
      {showKpi && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]">
          <div className="flex items-baseline gap-1.5">
            <span className="text-ink-400">总市值</span>
            <span className="tabular font-semibold text-ink-900">{compact(totalValue)}</span>
            <span className="text-[10px] text-ink-400">{currency}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-ink-400">浮动盈亏</span>
            <span
              className={`tabular font-semibold ${
                pnlUp ? "text-gain-700" : "text-loss-700"
              }`}
            >
              {pnlUp ? "+" : ""}
              {compact(unrealizedPnL)}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-ink-400">持仓</span>
            <span className="tabular font-medium text-ink-800">{positionCount}</span>
            <span className="text-[10px] text-ink-400">
              只 ·{" "}
              {pnlPosCount > 0 && (
                <span style={{ color: pal.gainStroke }}>↑{pnlPosCount}</span>
              )}
              {pnlNegCount > 0 && (
                <span style={{ color: pal.lossStroke }}> ↓{pnlNegCount}</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ── 总市值走势 ── */}
      {showTrend && (
        <TotalTrendChart
          data={securitiesHistory}
          currency={currency}
          isDark={isDark}
          tall={mode !== "all"}
        />
      )}

      {/* ── 浮动盈亏走势 ── */}
      {showPnl && (
        <PnLTrendChart
          data={pnlHistory}
          currency={currency}
          isDark={isDark}
          tall={mode !== "all"}
        />
      )}

      {/* ── 持仓明细列表（按市场分组） ── */}
      {showDetail && (
        <MarketGroupedDetail positions={ranked} isDark={isDark} />
      )}
    </div>
  );
}

/* ─────────────── MarketGroupedDetail ─────────────── */

/**
 * 单行持仓的多列布局。列从左到右：
 *   名称（含代码）/ 市值 / 今日% / 今日盈亏 / 总% / 总盈亏 / sparkline
 * 用 CSS grid 保证多行间列对齐。
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_72px_64px_72px_64px_72px_56px] items-center gap-2";

function PositionRow({ p, isDark }: { p: SecuritiesPosition; isDark: boolean }) {
  const totalUp = (p.pnlPct ?? 0) >= 0;
  const hasTotal = p.pnlPct != null;

  const hasToday = p.todayChangePct != null;
  const todayUp = (p.todayChangePct ?? 0) >= 0;

  const colorClass = (up: boolean, has: boolean) =>
    !has ? "text-ink-400" : up ? "text-gain-700" : "text-loss-700";

  return (
    <div className={`${ROW_GRID} py-2 text-[12px] leading-tight`}>
      {/* 名称 + 代码 + 币种 */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-ink-900">{p.name}</span>
          {p.symbol && (
            <span className="shrink-0 rounded bg-canvas-sunk px-1 py-0.5 font-mono text-[10px] tabular text-ink-500">
              {p.symbol}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[10px] text-ink-400">{p.currency}</div>
      </div>

      {/* 市值 */}
      <div className="text-right tabular font-medium text-ink-800">
        {compact(p.baseValue)}
      </div>

      {/* 今日 % */}
      <div className={`text-right tabular ${colorClass(todayUp, hasToday)}`}>
        {hasToday ? pctStr(p.todayChangePct!, 2) : "—"}
      </div>
      {/* 今日 盈亏（基准币） */}
      <div className={`text-right tabular ${colorClass(todayUp, hasToday)}`}>
        {hasToday && p.todayPnLBase != null
          ? (p.todayPnLBase >= 0 ? "+" : "") + compact(p.todayPnLBase)
          : "—"}
      </div>

      {/* 总 % */}
      <div className={`text-right tabular ${colorClass(totalUp, hasTotal)}`}>
        {hasTotal ? pctStr(p.pnlPct!, 2) : "—"}
      </div>
      {/* 总盈亏（基准币） */}
      <div className={`text-right tabular ${colorClass(totalUp, hasTotal)}`}>
        {hasTotal && p.pnlBase != null
          ? (p.pnlBase >= 0 ? "+" : "") + compact(p.pnlBase)
          : "—"}
      </div>

      <div className="flex justify-end">
        <MiniSparkline
          history={p.priceHistory}
          unitCost={p.unitCost}
          currentPrice={p.currentPrice}
          isDark={isDark}
        />
      </div>
    </div>
  );
}

function PositionHeaderRow() {
  return (
    <div
      className={`${ROW_GRID} pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400`}
    >
      <div>名称</div>
      <div className="text-right">市值</div>
      <div className="text-right">今日%</div>
      <div className="text-right">今日</div>
      <div className="text-right">总%</div>
      <div className="text-right">总盈亏</div>
      <div className="text-right">走势</div>
    </div>
  );
}

function MarketGroupedDetail({
  positions,
  isDark
}: {
  positions: SecuritiesPosition[];
  isDark: boolean;
}) {
  // 按固定顺序分组
  const groups = new Map<MarketLabel, SecuritiesPosition[]>();
  for (const m of MARKET_ORDER) groups.set(m, []);
  for (const p of positions) {
    const m = marketLabel(p.market);
    groups.get(m)!.push(p);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 表头：仅展示一次，统一对齐 */}
      <PositionHeaderRow />

      {MARKET_ORDER.map((m) => {
        const list = groups.get(m)!;
        if (list.length === 0) return null;
        // 组内若有任一标的带「今日」数据则汇总今日；否则今日显示 —
        const hasTodayInGroup = list.some((p) => p.todayChangePct != null);
        const todayBaseSum = hasTodayInGroup
          ? list.reduce((s, p) => s + (p.todayPnLBase ?? 0), 0)
          : null;
        const totalBaseSum = list.reduce((s, p) => s + (p.pnlBase ?? 0), 0);
        const todayUp = (todayBaseSum ?? 0) >= 0;
        const totalUp = totalBaseSum >= 0;
        return (
          <div key={m}>
            {/* 市场标题行 */}
            <div className="mb-0.5 flex items-center gap-2 border-t border-hair pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {m}
              </span>
              <span className="text-[10px] text-ink-300">{list.length} 只</span>
              <span className="ml-auto flex items-baseline gap-3 text-[10px]">
                <span className="text-ink-400">
                  今日{" "}
                  {todayBaseSum == null ? (
                    <span className="tabular font-medium text-ink-400">—</span>
                  ) : (
                    <span
                      className={`tabular font-medium ${
                        todayUp ? "text-gain-700" : "text-loss-700"
                      }`}
                    >
                      {todayBaseSum >= 0 ? "+" : ""}
                      {compact(todayBaseSum)}
                    </span>
                  )}
                </span>
                <span className="text-ink-400">
                  累计{" "}
                  <span
                    className={`tabular font-medium ${totalUp ? "text-gain-700" : "text-loss-700"}`}
                  >
                    {totalBaseSum >= 0 ? "+" : ""}
                    {compact(totalBaseSum)}
                  </span>
                </span>
              </span>
            </div>
            {/* 持仓列表 */}
            <div className="flex flex-col divide-y divide-hair">
              {list.map((p) => (
                <PositionRow key={p.id} p={p} isDark={isDark} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
