import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Percent,
  Plus,
  TrendingUp,
  Wallet
} from "lucide-react";
import { getDB, getSetting } from "@/lib/db";
import { kickoffRatesRefresh } from "@/lib/fx";
import { kickoffStockPricesRefresh } from "@/lib/stocks";
import { valueAll, type ValuedAsset } from "@/lib/valuation";
import {
  computeTodayStockPnL,
  ensureTodaySnapshot,
  listChanges,
  listSnapshots
} from "@/lib/history";
import { buildSuggestions } from "@/lib/advisor";
import { AllocationChart } from "@/components/charts/AllocationChart";
import { HistoryChart } from "@/components/charts/HistoryChart";
import { BaseCurrencyPicker } from "./_components/BaseCurrencyPicker";
import { formatDate, formatMoney, formatPercent, formatCnDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // 后台刷新：不阻塞首屏。首次访问时会显示旧/空数据，下次访问即更新。
  kickoffRatesRefresh();
  kickoffStockPricesRefresh();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const valuation = valueAll(baseCurrency);
  ensureTodaySnapshot(baseCurrency);
  const snapshots = listSnapshots(baseCurrency, 365);
  const recentChanges = listChanges(8);
  const suggestions = buildSuggestions({
    items: valuation.items,
    total: valuation.total,
    byCategory: valuation.byCategory,
    baseCurrency
  });

  const totalLatest = valuation.netWorth;
  const totalAssets = valuation.totalAssets;
  const totalLiabilities = valuation.totalLiabilities;
  const hasLiabilities = totalLiabilities > 0;
  const prevSnap = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const delta = prevSnap ? totalLatest - prevSnap.total_value : 0;
  const deltaPct = prevSnap && prevSnap.total_value ? delta / prevSnap.total_value : 0;

  const firstSnap = snapshots[0];
  const totalSinceStart = firstSnap ? totalLatest - firstSnap.total_value : 0;
  const totalSincePct =
    firstSnap && firstSnap.total_value ? totalSinceStart / firstSnap.total_value : 0;

  const kpis = computeKpis(valuation.items);

  const secForTodayKpi = valuation.items.filter(
    (a) => a.category_code === "securities" && (a.quantity ?? 0) > 0
  );
  const hasSecuritiesForKpi = secForTodayKpi.length > 0;

  // 证券今日：computeTodayStockPnL 仅统计 change_quote_date 为今天的标的
  const todaySecPnL = computeTodayStockPnL(
    secForTodayKpi.map((a) => ({
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

  // 资产构成图只展示正向资产大类
  const allocationByCategory = Object.fromEntries(
    Object.entries(valuation.byCategory).filter(([code]) => code !== "liability")
  ) as typeof valuation.byCategory;
  const upcoming = valuation.items
    .filter((a) => a.maturity_date)
    .map((a) => ({ ...a, days: daysUntil(a.maturity_date!) }))
    .filter((a) => a.days !== null && a.days >= 0 && a.days <= 60)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, 12);

  const hasAssets = valuation.items.length > 0;

  // 原币分布（仅资产端，不含负债）：CNY / USD / HKD 三个主要币种
  const nativeTotals = (() => {
    const acc: Record<string, { value: number; count: number }> = {};
    for (const a of valuation.items) {
      if (a.category_code === "liability") continue;
      const key = (a.currency || "").toUpperCase();
      if (!key) continue;
      (acc[key] ??= { value: 0, count: 0 });
      acc[key].value += a.native_value;
      acc[key].count += 1;
    }
    return acc;
  })();
  const nativeShown: Array<{ code: string; value: number; count: number }> = [
    "CNY",
    "USD",
    "HKD"
  ].map((code) => ({
    code,
    value: nativeTotals[code]?.value ?? 0,
    count: nativeTotals[code]?.count ?? 0
  }));
  const db = getDB();
  const accountCount = (db.prepare("SELECT COUNT(*) AS c FROM account").get() as { c: number }).c;
  const lastUpdated = db
    .prepare("SELECT MAX(updated_at) AS t FROM asset")
    .get() as { t: string | null };

  return (
    <div className="space-y-6">
      {/* Hero: 总资产 */}
      <section className="card">
        <div className="card-body space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="eyebrow">{hasLiabilities ? "净资产" : "总资产净值"}</div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="kpi-number text-5xl">
                  {formatMoney(totalLatest, baseCurrency, 2)}
                </span>
                <DeltaBadge value={delta} pct={deltaPct} currency={baseCurrency} label="较上次快照" />
              </div>
              {hasLiabilities && (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px]">
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-ink-400">总资产</span>
                    <span className="tabular font-medium text-ink-800">
                      {formatMoney(totalAssets, baseCurrency)}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-ink-400">总负债</span>
                    <span className="tabular font-medium text-loss-700">
                      -{formatMoney(totalLiabilities, baseCurrency)}
                    </span>
                  </span>
                  {totalAssets > 0 && (
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-ink-400">负债率</span>
                      <span className="tabular font-medium text-ink-700">
                        {formatPercent(totalLiabilities / totalAssets, 1)}
                      </span>
                    </span>
                  )}
                </div>
              )}
              {hasAssets && (
                <div className="mt-3 flex flex-wrap items-stretch gap-2">
                  {nativeShown.map((n) => (
                    <NativeTotalChip
                      key={n.code}
                      code={n.code}
                      value={n.value}
                      count={n.count}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <BaseCurrencyPicker current={baseCurrency} />
              <Link href="/assets/new" className="btn-primary">
                <Plus className="h-3.5 w-3.5" /> 新增
              </Link>
            </div>
          </div>

          {/* 最近变动：单行垂直跑马灯（每条 ~2.8s 停留，hover 暂停） */}
          {recentChanges.length > 0 && (
            <div className="flex items-center gap-3 border-t border-hair pt-3 text-[12px]">
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-400">
                最近变动
              </span>
              {recentChanges.length === 1 ? (
                // 仅 1 条无需滚动，直接静态展示
                <div className="flex-1 min-w-0 truncate">
                  <RecentChangeRow c={recentChanges[0]} />
                </div>
              ) : (
                <div
                  className="marquee-v flex-1 min-w-0"
                  aria-label="最近变动滚动列表，鼠标悬停可暂停"
                  tabIndex={0}
                >
                  <ul
                    className="marquee-v-track"
                    style={{
                      animationDuration: `${Math.max(
                        recentChanges.length * 2.8,
                        12
                      )}s`
                    }}
                  >
                    {/* 渲染两份首尾相接，配合 translateY(-50%) 无缝循环 */}
                    {[...recentChanges, ...recentChanges].map((c, i) => (
                      <li
                        key={`${c.id}-${i}`}
                        className="marquee-v-row"
                        aria-hidden={i >= recentChanges.length || undefined}
                      >
                        <RecentChangeRow c={c} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link
                href="/history"
                className="shrink-0 text-[11px] text-ink-500 hover:text-gold-500"
              >
                查看全部
              </Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hair pt-3 text-[11px] text-ink-400">
            <span>
              共 {valuation.items.length} 笔资产 · {accountCount} 个账户
            </span>
            {firstSnap && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular">
                  快照数 {snapshots.length} 个历史点
                </span>
              </>
            )}
            {lastUpdated.t && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular">
                  最近更新 {formatCnDateTime(lastUpdated.t).slice(0, 16)}
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* 资产摘要：把 4 个核心指标拆成独立瓦片 + 即将到期单独成行 */}
      {hasAssets && (
        <section className="card">
          <div className="card-header">
            <div className="card-title">资产摘要</div>
            <span className="text-[11px] text-ink-400">以 {baseCurrency} 结算</span>
          </div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {firstSnap && (
                <SummaryTile
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label="累计变化"
                  tone={
                    totalSinceStart > 0
                      ? "gain"
                      : totalSinceStart < 0
                        ? "loss"
                        : "neutral"
                  }
                  value={
                    <span className="tabular">
                      {totalSinceStart >= 0 ? "+" : ""}
                      {formatMoney(totalSinceStart, baseCurrency)}
                    </span>
                  }
                  hint={<DeltaPill value={totalSinceStart} pct={totalSincePct} />}
                />
              )}
              <SummaryTile
                icon={<Activity className="h-3.5 w-3.5" />}
                label="浮动盈亏"
                tone={
                  kpis.unrealized > 0
                    ? "gain"
                    : kpis.unrealized < 0
                      ? "loss"
                      : "neutral"
                }
                value={
                  <span className="tabular">
                    {kpis.unrealized > 0 ? "+" : ""}
                    {formatMoney(kpis.unrealized, baseCurrency)}
                  </span>
                }
                hint={
                  kpis.investedCost > 0
                    ? `成本回报 ${formatPercent(kpis.unrealized / kpis.investedCost, 2)}`
                    : "暂无成本数据"
                }
              />
              <SummaryTile
                icon={<CalendarClock className="h-3.5 w-3.5" />}
                label="证券今日"
                tone={
                  !hasSecuritiesForKpi
                    ? "muted"
                    : todaySecPnL.perAsset.size === 0
                      ? "neutral"
                      : todaySecPnL.totalBase > 0
                        ? "gain"
                        : todaySecPnL.totalBase < 0
                          ? "loss"
                          : "neutral"
                }
                value={
                  hasSecuritiesForKpi ? (
                    <span className="tabular">
                      {todaySecPnL.totalBase > 0 ? "+" : ""}
                      {formatMoney(todaySecPnL.totalBase, baseCurrency)}
                    </span>
                  ) : (
                    <span className="tabular text-ink-400">—</span>
                  )
                }
                hint={
                  hasSecuritiesForKpi
                    ? `${todaySecPnL.perAsset.size} 只`
                    : "暂无证券持仓（或份额均为 0）"
                }
              />
              <SummaryTile
                icon={<Percent className="h-3.5 w-3.5" />}
                label="加权年化"
                tone="info"
                value={
                  <span className="tabular">
                    {kpis.weightedYield != null
                      ? `${(kpis.weightedYield * 100).toFixed(2)}%`
                      : "—"}
                  </span>
                }
                hint={
                  kpis.weightedYield != null
                    ? `${kpis.yieldingCount} 笔存款/理财`
                    : "未填写年化利率"
                }
              />
            </div>

            {upcoming.length > 0 && (
              <div className="flex items-center gap-3 border-t border-hair pt-3 text-[12px]">
                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-400">
                  即将到期
                </span>
                <div className="flex-1 overflow-x-auto">
                  <ul className="flex items-center gap-4 whitespace-nowrap">
                    {upcoming.map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        <span
                          className={`chip tabular shrink-0 ${
                            (a.days ?? 0) <= 7 ? "chip-loss" : "chip-gold"
                          }`}
                        >
                          {a.days} 天
                        </span>
                        <span className="font-medium text-ink-800">{a.name}</span>
                        <span className="text-ink-400">
                          · {a.account_name} · {formatDate(a.maturity_date)}
                        </span>
                        {a.annual_rate != null && (
                          <span className="chip tabular shrink-0">
                            年化 {formatPercent(a.annual_rate, 2)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <span className="shrink-0 text-[11px] text-ink-400">
                  60 天内 · {upcoming.length} 笔
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {valuation.missingRates.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-gold-200 bg-gold-100 px-4 py-3 text-[13px] text-gold-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            部分汇率缺失：
            <span className="tabular font-medium">{valuation.missingRates.join("、")}</span>
            。请前往「设置 · 汇率」刷新或手动录入。
          </div>
        </div>
      )}

      {/* 资产构成 + 净值走势 左右双列（仿照证券页布局） */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-stretch">
        {/* 左：资产构成 */}
        <section className="card flex flex-col">
          <div className="card-header gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="card-title shrink-0">资产构成</div>
              {hasAssets && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <AllocationStat
                    label="现金等价物"
                    value={kpis.liquidity}
                    total={totalAssets}
                    currency={baseCurrency}
                  />
                  <AllocationStat
                    label="投资类"
                    value={kpis.invested}
                    total={totalAssets}
                    currency={baseCurrency}
                    hint="基金/股票/其他"
                  />
                </div>
              )}
            </div>
            <Link
              href="/assets"
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-500 hover:text-gold-500"
            >
              查看明细
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="card-body flex-1">
            <AllocationChart
              data={allocationByCategory}
              currency={baseCurrency}
              total={totalAssets}
            />
          </div>
        </section>

        {/* 右：净值走势 */}
        <section className="card flex flex-col">
          <div className="card-header">
            <div className="flex items-center gap-3">
              <div className="card-title">净值走势</div>
              <span className="chip tabular">以 {baseCurrency} 结算</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-ink-400">
              <span>{snapshots.length} 个历史点</span>
              <Link href="/history" className="text-gold-500 hover:text-gold-600">
                查看全部
              </Link>
            </div>
          </div>
          <div className="card-body flex-1">
            <HistoryChart data={snapshots} currency={baseCurrency} />
          </div>
        </section>
      </div>

      {/* 智能建议（独占一行） */}
      <section className="card">
        <div className="card-header">
          <div className="card-title">智能建议</div>
          <span className="chip">{suggestions.length} 条</span>
        </div>
        <div className="card-body grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {suggestions.map((s, i) => (
            <div
              key={i}
              className={`flex gap-3 rounded-md border px-3.5 py-2.5 ${
                s.level === "danger"
                  ? "border-loss-100 bg-loss-50"
                  : s.level === "warn"
                    ? "border-gold-200 bg-gold-100"
                    : "border-hair bg-canvas-sunk"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {s.level === "danger" ? (
                  <AlertCircle className="h-4 w-4 text-loss-600" />
                ) : s.level === "warn" ? (
                  <AlertTriangle className="h-4 w-4 text-gold-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-ink-500" />
                )}
              </span>
              <div className="min-w-0 text-[13px]">
                <div
                  className={`font-medium ${
                    s.level === "danger"
                      ? "text-loss-700"
                      : s.level === "warn"
                        ? "text-gold-700"
                        : "text-ink-800"
                  }`}
                >
                  {s.title}
                </div>
                <div className="mt-0.5 text-ink-500">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {!hasAssets && <OnboardingBanner accountCount={accountCount} />}
    </div>
  );
}

/* ----------------- helper components ----------------- */

function DeltaBadge({
  value,
  pct,
  currency,
  label
}: {
  value: number;
  pct: number;
  currency: string;
  label: string;
}) {
  if (value === 0)
    return <span className="chip tabular">—  {label}</span>;
  const up = value > 0;
  return (
    <span className={`chip tabular ${up ? "chip-gain" : "chip-loss"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      <span className="font-semibold">{formatPercent(pct)}</span>
      <span className="opacity-60">·</span>
      <span>
        {up ? "+" : ""}
        {formatMoney(value, currency)}
      </span>
      <span className="opacity-60">{label}</span>
    </span>
  );
}

function DeltaPill({ value, pct }: { value: number; pct: number }) {
  const up = value > 0;
  return (
    <span
      className={`tabular inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${
        value === 0
          ? "bg-canvas-sunk text-ink-400"
          : up
            ? "bg-gain-50 text-gain-700"
            : "bg-loss-50 text-loss-700"
      }`}
    >
      {value === 0 ? "—" : up ? "▲" : "▼"}
      {formatPercent(pct)}
    </span>
  );
}

function KpiInline({
  label,
  value,
  hint
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-ink-400">{label}</span>
      <span className="tabular font-medium text-ink-800">{value}</span>
      {hint && <span className="text-ink-400">{hint}</span>}
    </div>
  );
}

/**
 * 资产摘要里的指标瓦片：左侧一根 2px 语义色条 + 顶部图标&标签 + 主数值 + hint。
 * tone 对应的色彩语义：
 *   gain  → 红涨绿跌的「涨」（红）
 *   loss  → 红涨绿跌的「跌」（绿）
 *   info  → 中性高亮（金色，强调）
 *   neutral / muted → 暗淡，不带色
 */
function SummaryTile({
  icon,
  label,
  value,
  hint,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone: "gain" | "loss" | "info" | "neutral" | "muted";
}) {
  const accent = {
    gain: "before:bg-gain-500",
    loss: "before:bg-loss-500",
    info: "before:bg-gold-500",
    neutral: "before:bg-ink-300",
    muted: "before:bg-ink-200"
  }[tone];
  const valueColor = {
    gain: "text-gain-700",
    loss: "text-loss-700",
    info: "text-ink-900",
    neutral: "text-ink-800",
    muted: "text-ink-400"
  }[tone];
  const iconColor = {
    gain: "text-gain-600",
    loss: "text-loss-600",
    info: "text-gold-500",
    neutral: "text-ink-400",
    muted: "text-ink-300"
  }[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-md border border-hair bg-canvas-sunk/50 px-3.5 py-3 before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:rounded-l-md ${accent}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={iconColor}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          {label}
        </span>
      </div>
      <div className={`mt-1.5 text-[18px] font-bold leading-none tabular ${valueColor}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-1.5 text-[11px] leading-tight text-ink-500">{hint}</div>
      )}
    </div>
  );
}

function NativeTotalChip({
  code,
  value,
  count
}: {
  code: string;
  value: number;
  count: number;
}) {
  const labels: Record<string, string> = { CNY: "人民币", USD: "美元", HKD: "港元" };
  const empty = count === 0;
  return (
    <div
      className={`flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-[12px] ${
        empty
          ? "border-hair/60 bg-canvas-sunk/40 text-ink-400"
          : "border-hair bg-canvas-sunk/70"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        {code}
      </span>
      <span className={`tabular font-medium ${empty ? "text-ink-400" : "text-ink-900"}`}>
        {formatMoney(value, code, 2)}
      </span>
      <span className="text-[10px] text-ink-400">
        {labels[code] ?? code} · {count} 笔
      </span>
    </div>
  );
}

function AllocationStat({
  label,
  value,
  total,
  currency,
  hint
}: {
  label: string;
  value: number;
  total: number;
  currency: string;
  hint?: string;
}) {
  const pct = total ? value / total : 0;
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border border-hair bg-canvas-sunk/70 px-2 py-1">
      <span className="text-ink-400">{label}</span>
      <span className="tabular font-medium text-ink-900">
        {formatMoney(value, currency, 0)}
      </span>
      <span className="tabular text-ink-500">{formatPercent(pct, 1)}</span>
      {hint && <span className="text-ink-400">· {hint}</span>}
    </span>
  );
}

/**
 * "最近变动"单行内容（用于 Hero 底部跑马灯 / 单条静态展示）。
 * 抽离的目的：在 marquee 渲染两份相同 list 时复用同一份 DOM 描述。
 */
function RecentChangeRow({
  c
}: {
  c: {
    id: number;
    action: string;
    asset_name: string | null;
    base_value_cny: number | null;
    created_at: string;
  };
}) {
  return (
    <>
      <ActionDot action={c.action} />
      <span className="font-medium text-ink-800">{c.asset_name ?? "-"}</span>
      {c.base_value_cny != null && (
        <span
          className={`tabular ${
            c.base_value_cny < 0 ? "text-loss-700" : "text-ink-500"
          }`}
        >
          {c.base_value_cny < 0 ? "-" : ""}
          {formatMoney(Math.abs(c.base_value_cny), "CNY")}
        </span>
      )}
      <span className="text-ink-400">
        · {formatCnDateTime(c.created_at).slice(5, 16)}
      </span>
    </>
  );
}

function ActionDot({ action }: { action: string }) {
  const map: Record<string, string> = {
    create: "bg-gain-500",
    update: "bg-ink-500",
    delete: "bg-loss-500"
  };
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${map[action] ?? "bg-ink-300"}`}
      aria-hidden="true"
    />
  );
}

function OnboardingBanner({ accountCount }: { accountCount: number }) {
  return (
    <section className="card">
      <div className="card-body flex flex-col items-center justify-center gap-3 py-10 text-center">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-500 text-canvas"
          style={{ boxShadow: "0 0 24px -2px rgba(212, 169, 78, 0.5)" }}
        >
          <Wallet className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-ink-900">
            开始记录你的第一笔资产
          </div>
          <div className="mt-1 text-[13px] text-ink-500">
            {accountCount === 0
              ? "请先到「持仓」页创建一个账户（例如：工行活期），再添加资产。"
              : "系统已自动初始化 6 个大类，现在可以添加第一笔资产了。"}
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <Link href="/assets" className="btn-outline">
            管理账户
          </Link>
          <Link href="/assets/new" className="btn-primary">
            <Plus className="h-3.5 w-3.5" />
            新增资产
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ----------------- logic helpers ----------------- */

function computeKpis(items: ValuedAsset[]) {
  let liquidity = 0;
  let invested = 0;
  let crypto = 0;
  let liabilityCount = 0;
  let unrealized = 0;
  let investedCost = 0;
  let yieldWeighted = 0;
  let yieldDenom = 0;
  let yieldingCount = 0;
  for (const a of items) {
    if (a.category_code === "liability") {
      liabilityCount += 1;
      continue;
    }
    if (a.category_code === "cash" || a.category_code === "deposit") {
      liquidity += a.base_value;
    } else if (a.category_code === "crypto") {
      crypto += a.base_value;
    } else {
      // 基金 / 证券股票 / 其他 —— 计为投资类
      invested += a.base_value;
    }

    if (a.unit_cost != null && a.current_price != null) {
      const costBase = a.unit_cost * (a.quantity ?? 0);
      const unrealNative = (a.current_price - a.unit_cost) * (a.quantity ?? 0);
      const ratio = a.native_value !== 0 ? a.base_value / a.native_value : 1;
      investedCost += costBase * ratio;
      unrealized += unrealNative * ratio;
    }
    if (a.annual_rate != null && a.annual_rate > 0) {
      yieldWeighted += a.annual_rate * a.base_value;
      yieldDenom += a.base_value;
      yieldingCount += 1;
    }
  }
  return {
    liquidity,
    invested,
    crypto,
    liabilityCount,
    unrealized,
    investedCost,
    weightedYield: yieldDenom > 0 ? yieldWeighted / yieldDenom : null,
    yieldingCount,
    cryptoCount: items.filter((a) => a.category_code === "crypto").length
  };
}

function daysUntil(dateStr: string): number | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diff = Math.floor(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000
  );
  return diff;
}
