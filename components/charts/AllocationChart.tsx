"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from "recharts";
import { useTheme } from "@/lib/useTheme";

// 负债不参与资产构成（单独展示），此处只列正向资产大类
const CATEGORY_ORDER = [
  "cash",
  "deposit",
  "fund",
  "securities",
  "crypto",
  "other"
] as const;

const LABELS: Record<string, string> = {
  cash: "现金",
  deposit: "存款/理财",
  fund: "基金",
  securities: "证券/股票",
  crypto: "加密货币",
  other: "其他"
};

const DARK_COLORS: Record<string, string> = {
  cash: "#60A5FA",
  deposit: "#818CF8",
  fund: "#D4A94E",
  securities: "#34D399",
  crypto: "#F59E0B",
  other: "#94A3B8"
};

const LIGHT_COLORS: Record<string, string> = {
  cash: "#2563EB",
  deposit: "#4F46E5",
  fund: "#B88B3A",
  securities: "#059669",
  crypto: "#D97706",
  other: "#64748B"
};

export function AllocationChart({
  data,
  currency,
  total
}: {
  data: Record<string, number>;
  currency: string;
  total: number;
}) {
  const isDark = useTheme() === "dark";
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const stroke = isDark ? "#111827" : "#FFFFFF";
  const hoverRowBg = isDark ? "rgba(148, 163, 184, 0.08)" : "rgba(15, 42, 71, 0.05)";

  const [activeKey, setActiveKey] = useState<string | null>(null);

  const pieRows = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      name: LABELS[k] ?? k,
      key: k,
      value: Number(v.toFixed(2))
    }));

  // Legend 列表始终展示全部 6 大类（含 0 值），直观呈现资产构成
  const legendRows = CATEGORY_ORDER.map((k) => {
    const v = data[k] ?? 0;
    return {
      key: k,
      name: LABELS[k],
      value: v,
      pct: total ? v / total : 0,
      color: colors[k] ?? colors.other
    };
  });

  const nonEmptyCount = pieRows.length;
  const activeIndex = activeKey
    ? pieRows.findIndex((r) => r.key === activeKey)
    : -1;

  const moneyFmt = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const activeRow = legendRows.find((r) => r.key === activeKey) ?? null;

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-center">
      {/* 左：饼图 */}
      <div className="relative mx-auto h-[220px] w-full max-w-[260px] shrink-0 md:mx-0 md:w-[260px]">
        {nonEmptyCount === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-400">
            暂无数据
          </div>
        ) : (
          <>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieRows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={64}
                  outerRadius={96}
                  paddingAngle={1}
                  stroke={stroke}
                  strokeWidth={2}
                  isAnimationActive={false}
                  activeIndex={activeIndex >= 0 ? activeIndex : undefined}
                  activeShape={(props: any) => (
                    <Sector
                      {...props}
                      outerRadius={(props.outerRadius ?? 0) + 6}
                    />
                  )}
                  onMouseEnter={(_, idx) => {
                    const r = pieRows[idx];
                    if (r) setActiveKey(r.key);
                  }}
                  onMouseLeave={() => setActiveKey(null)}
                >
                  {pieRows.map((r) => {
                    const dimmed = activeKey != null && activeKey !== r.key;
                    return (
                      <Cell
                        key={r.key}
                        fill={colors[r.key] ?? colors.other}
                        opacity={dimmed ? 0.35 : 1}
                        style={{ transition: "opacity 140ms ease" }}
                      />
                    );
                  })}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              {activeRow ? (
                <>
                  <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-400">
                    {activeRow.name}
                  </div>
                  <div className="tabular mt-0.5 text-[18px] font-semibold text-ink-900">
                    {moneyFmt(activeRow.value)}{" "}
                    <span className="text-[11px] text-ink-400">{currency}</span>
                  </div>
                  <div className="tabular text-[11px] text-ink-500">
                    {(activeRow.pct * 100).toFixed(1)}%
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-400">
                    大类
                  </div>
                  <div className="tabular mt-0.5 text-lg font-semibold text-ink-900">
                    {nonEmptyCount}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 右：6 大类详情（直接展示，不需悬停） */}
      <ul className="flex-1 divide-y divide-hair/60 border-t border-hair/60 md:border-t-0">
        {legendRows.map((r) => {
          const isZero = r.value <= 0;
          const isActive = activeKey === r.key;
          return (
            <li
              key={r.key}
              onMouseEnter={() => !isZero && setActiveKey(r.key)}
              onMouseLeave={() => setActiveKey(null)}
              className={`flex items-center justify-between gap-4 py-2 text-[13px] transition-colors duration-150 ${
                isZero ? "opacity-50" : "cursor-default"
              }`}
              style={{
                background: isActive ? hoverRowBg : "transparent",
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 6
              }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm transition-transform duration-150"
                  style={{
                    background: r.color,
                    transform: isActive ? "scale(1.3)" : "scale(1)"
                  }}
                  aria-hidden="true"
                />
                <span
                  className={`truncate ${
                    isActive ? "font-medium text-ink-900" : "text-ink-700"
                  }`}
                >
                  {r.name}
                </span>
              </div>
              <div className="flex shrink-0 items-baseline gap-3 tabular">
                <span className={isActive ? "text-ink-900" : "text-ink-800"}>
                  {isZero ? "—" : `${moneyFmt(r.value)} ${currency}`}
                </span>
                <span className="w-14 text-right text-[11px] text-ink-400">
                  {isZero ? "0%" : `${(r.pct * 100).toFixed(1)}%`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
