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
import { formatCompact, formatMoney } from "@/lib/utils";
import type { NetWorthChange } from "@/lib/netWorthChange";
import { NetWorthBreakdown } from "@/components/NetWorthBreakdown";

interface Point {
  date: string;
  total_value: number;
  change: NetWorthChange;
}

export function HistoryChart({
  data,
  currency
}: {
  data: Point[];
  currency: string;
}) {
  const isDark = useTheme() === "dark";

  const palette = isDark
    ? {
        grid: "#1E293B",
        axisLine: "#1E293B",
        tick: "#64748B",
        refLine: "#334155",
        activeDotStroke: "#0B1020",
        gainStroke: "#F87171",
        lossStroke: "#34D399"
      }
    : {
        grid: "#E7E4D9",
        axisLine: "#E7E4D9",
        tick: "#7A8699",
        refLine: "#D4D0C3",
        activeDotStroke: "#FFFFFF",
        gainStroke: "#DC2626",
        lossStroke: "#059669"
      };

  if (!data || data.length === 0) {
    return (
      <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-[12px] text-ink-400">
        <span>尚无历史快照</span>
        <span className="text-ink-300">
          新增/修改资产或每日首次访问总览时会自动记录
        </span>
      </div>
    );
  }

  const rows = data.map((p) => ({
    date: p.date,
    value: Number(p.total_value.toFixed(2)),
    change: p.change
  }));

  const first = rows[0].value;
  const last = rows[rows.length - 1].value;
  const up = last >= first;
  const stroke = up ? palette.gainStroke : palette.lossStroke;

  return (
    <div className="h-[280px] w-full" data-testid="net-worth-chart">
      <ResponsiveContainer>
        <AreaChart accessibilityLayer data={rows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={isDark ? 0.28 : 0.2} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke={palette.grid}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: palette.tick, fontFamily: "JetBrains Mono" }}
            tickLine={false}
            axisLine={{ stroke: palette.axisLine }}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: palette.tick, fontFamily: "JetBrains Mono" }}
            tickFormatter={(v) => compact(v)}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine y={first} stroke={palette.refLine} strokeDasharray="3 3" />
          <Tooltip
            wrapperStyle={{ outline: "none", zIndex: 20 }}
            allowEscapeViewBox={{ x: false, y: true }}
            position={{ y: 8 }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !point) return null;
              return (
                <div className="w-[300px] max-w-[calc(100vw-48px)] space-y-3 rounded-lg border border-hair-strong bg-canvas-raised p-3.5 shadow-pop">
                  <div className="tabular text-[11px] text-ink-500">{point.date}</div>
                  <div className="flex items-baseline justify-between gap-4 text-[13px] text-ink-900">
                    <span>净值</span><span className="tabular font-semibold">{formatMoney(point.value, currency)}</span>
                  </div>
                  <NetWorthBreakdown change={point.change} currency={currency} compact />
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.8}
            fill="url(#netWorthFill)"
            activeDot={{ r: 4, stroke: palette.activeDotStroke, strokeWidth: 2, fill: stroke }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const compact = (v: number) => formatCompact(v, { digits: 1, useK: true });
