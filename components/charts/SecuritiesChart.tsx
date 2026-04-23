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
  /** P&L in native currency */
  pnlNative: number | null;
  /** P&L rate */
  pnlPct: number | null;
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

function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(1) + "亿";
  if (abs >= 1e4) return (v / 1e4).toFixed(1) + "万";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(v);
}

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

  const h = tall ? 260 : 120;

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
  const h = tall ? 260 : 160;

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

  const { totalValue, unrealizedPnL, positionCount, currency, securitiesHistory, pnlHistory, positions } =
    data;
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

function PositionRow({
  p,
  isDark
}: {
  p: SecuritiesPosition;
  isDark: boolean;
}) {
  const up = (p.pnlPct ?? 0) >= 0;
  const hasData = p.pnlPct != null;
  return (
    <div className="flex items-center gap-3 py-2.5 text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 leading-none">
          <span className="truncate font-medium text-ink-900">{p.name}</span>
          {p.symbol && (
            <span className="shrink-0 rounded bg-canvas-sunk px-1 py-0.5 font-mono text-[10px] tabular text-ink-500">
              {p.symbol}
            </span>
          )}
        </span>
        <span className="mt-0.5 text-[10px] text-ink-400">{p.currency}</span>
      </div>

      <div className="shrink-0 text-right">
        <div className="tabular font-medium text-ink-800">{compact(p.baseValue)}</div>
        {hasData && (
          <div
            className={`tabular text-[10px] ${up ? "text-gain-700" : "text-loss-700"}`}
          >
            {pctStr(p.pnlPct!)}
          </div>
        )}
      </div>

      <MiniSparkline
        history={p.priceHistory}
        unitCost={p.unitCost}
        currentPrice={p.currentPrice}
        isDark={isDark}
      />
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
      {MARKET_ORDER.map((m) => {
        const list = groups.get(m)!;
        if (list.length === 0) return null;
        return (
          <div key={m}>
            {/* 市场标题行 */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                {m}
              </span>
              <span className="text-[10px] text-ink-300">{list.length} 只</span>
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
