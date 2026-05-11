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

interface Point {
  date: string;
  total_value: number;
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
        tooltipBg: "#1E293B",
        tooltipBorder: "#334155",
        tooltipText: "#F1F5F9",
        tooltipLabel: "#94A3B8",
        activeDotStroke: "#0B1020",
        gainStroke: "#F87171",
        lossStroke: "#34D399"
      }
    : {
        grid: "#E7E4D9",
        axisLine: "#E7E4D9",
        tick: "#7A8699",
        refLine: "#D4D0C3",
        tooltipBg: "#0F172A",
        tooltipBorder: "#1E293B",
        tooltipText: "#F8FAFC",
        tooltipLabel: "#CBD5E1",
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
    value: Number(p.total_value.toFixed(2))
  }));

  const first = rows[0].value;
  const last = rows[rows.length - 1].value;
  const up = last >= first;
  const stroke = up ? palette.gainStroke : palette.lossStroke;

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
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
            wrapperStyle={{ outline: "none" }}
            contentStyle={{
              background: palette.tooltipBg,
              border: `1px solid ${palette.tooltipBorder}`,
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 12,
              color: palette.tooltipText,
              fontFamily: "JetBrains Mono, monospace"
            }}
            labelStyle={{
              color: palette.tooltipLabel,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4
            }}
            itemStyle={{ color: palette.tooltipText, padding: 0 }}
            formatter={(v: number) => [
              `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`,
              "净值"
            ]}
            labelFormatter={(l) => l}
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
