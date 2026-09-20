"use client";

import { useId, useState } from "react";
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
  currency,
  title
}: {
  data: Point[];
  currency: string;
  title?: string;
}) {
  const isDark = useTheme() === "dark";
  const [range, setRange] = useState(0);
  const gradientId = useId().replace(/:/g, "");


  const palette = {
    grid: "rgb(var(--hair))", axisLine: "rgb(var(--hair))", tick: "rgb(var(--ink-400))",
    refLine: "rgb(var(--hair-strong))", activeDotStroke: "rgb(var(--canvas-raised))"
  };

  if (!data || data.length === 0) {
    return (
      <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-[13px] text-ink-400">
        <span>尚无历史快照</span>
        <span className="text-ink-300">
          新增/修改资产或每日首次访问总览时会自动记录
        </span>
      </div>
    );
  }

  const endDate = data[data.length - 1].date;
  const cutoff = range ? new Date(Date.parse(`${endDate}T12:00:00Z`) - range * 86400000).toISOString().slice(0, 10) : "";
  const visibleData = cutoff ? data.filter((point) => point.date >= cutoff) : data;
  const rows = visibleData.map((p) => ({
    date: p.date,
    value: Number(p.total_value.toFixed(2)),
    change: p.change
  }));

  const first = rows[0].value;
  const stroke = "rgb(var(--brand-500))";

  return (
    <div className="w-full" data-testid="net-worth-chart">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {title ? <h2 className="card-title">{title}</h2> : <span className="tabular text-xs text-ink-400">{rows[0].date} — {rows[rows.length - 1].date}</span>}
        <div className="segmented" aria-label="净值显示区间">{[{ value: 30, label: "1月" }, { value: 90, label: "3月" }, { value: 365, label: "1年" }, { value: 0, label: "全部" }].map((item) => <button key={item.value} type="button" aria-pressed={range === item.value} onClick={() => setRange(item.value)} className={`segmented-item ${range === item.value ? "segmented-item-active" : ""}`}>{item.label}</button>)}</div>
      </div>
      <div className="h-[320px] w-full"><ResponsiveContainer>
        <AreaChart accessibilityLayer data={rows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
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
            tick={{ fontSize: 12, fill: palette.tick, fontFamily: "inherit" }}
            tickLine={false}
            axisLine={{ stroke: palette.axisLine }}
            minTickGap={24}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 12, fill: palette.tick, fontFamily: "inherit" }}
            tickFormatter={(v) => compact(v)}
            tickLine={false}
            axisLine={false}
            width={76}
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
                  <div className="tabular text-[12px] text-ink-500">{point.date}</div>
                  <div className="flex items-baseline justify-between gap-4 text-[14px] text-ink-900">
                    <span>净值</span><span className="tabular font-semibold">{formatMoney(point.value, currency)}</span>
                  </div>
                  <NetWorthBreakdown change={point.change} currency={currency} compact />
                </div>
              );
            }}
          />
          <Area
            isAnimationActive={false}
            dot={rows.length === 1 ? { r: 4, fill: stroke } : false}
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2.2}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 4, stroke: palette.activeDotStroke, strokeWidth: 2, fill: stroke }}
          />
        </AreaChart>
      </ResponsiveContainer></div>
    </div>
  );
}

const compact = (v: number) => formatCompact(v, { digits: 1, useK: true });
