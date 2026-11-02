import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Plus,
  Wallet
} from "lucide-react";
import { getDB, getSetting } from "@/lib/db";
import { kickoffRatesRefresh, getLastFxRefreshAt, getLastFxRefreshError } from "@/lib/fx";
import {
  kickoffStockPricesRefresh,
  getLastStocksRefreshAt,
  getLastStocksRefreshError,
  parseStockSymbol
} from "@/lib/stocks";
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
import { NetWorthDelta } from "./_components/NetWorthDelta";
import { buildNetWorthHistory } from "@/lib/netWorthHistory";
import { BaseCurrencyPicker } from "./_components/BaseCurrencyPicker";
import { formatDate, formatMoney, formatPercent, formatCnDateTime } from "@/lib/utils";
import { getJuheFxAppKey } from "@/lib/juheKeys";
import {
  isAnyStockMarketOpen,
  isWeekendBeijing,
  shouldRefreshFxEvery8h,
  shouldRefreshStocks,
  todayCn
} from "@/lib/time";
import { DataFreshnessBanner } from "./_components/DataFreshness";
import { accrueTodayInterest } from "@/lib/interest";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // 后台刷新：不阻塞首屏。首次访问时会显示旧/空数据，下次访问即更新。
  kickoffRatesRefresh();
  kickoffStockPricesRefresh();
  accrueTodayInterest();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const valuation = valueAll(baseCurrency);
  ensureTodaySnapshot(baseCurrency);
  const snapshots = listSnapshots(baseCurrency, 365);
  const historyPoints = buildNetWorthHistory(snapshots, { baseCurrency, valuation });
  const latestChange = historyPoints.at(-1)!.change;
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

  const firstSnap = snapshots[0];
  const totalSinceStart = firstSnap ? totalLatest - firstSnap.total_value : 0;
  const totalSincePct =
    firstSnap && firstSnap.total_value ? totalSinceStart / firstSnap.total_value : 0;

  const kpis = computeKpis(valuation.items);

  const secForTodayKpi = valuation.items.filter(
    (a) => a.category_code === "securities" && (a.quantity ?? 0) > 0
  );
  const stockMarketByAssetId = new Map(
    secForTodayKpi.map(
      (asset) => [asset.id, parseStockSymbol(asset.symbol)?.market ?? null] as const
    )
  );

  // 沪深/港股取北京时间今天；美股最近交易日最多保留至北京次日结束。
  const todaySecPnL = computeTodayStockPnL(
    secForTodayKpi.map((a) => ({
      id: a.id,
      currency: a.currency,
      quantity: a.quantity ?? 0,
      currentPrice: a.current_price,
      changePercent: a.change_percent,
      market: stockMarketByAssetId.get(a.id),
      changeQuoteDate: a.change_quote_date
    })),
    baseCurrency
  );
  const hasTodayQuotes = todaySecPnL.perAsset.size > 0;
  const hasSecuritiesForKpi = secForTodayKpi.length > 0 || todaySecPnL.closedPositionCount > 0;
  const weekend = isWeekendBeijing(todayCn());
  const fxLast = getLastFxRefreshAt();
  const stocksLast = getLastStocksRefreshAt();

  const freshness = {
    weekend: weekend && !isAnyStockMarketOpen(),
    fxConfigured: getJuheFxAppKey() !== "",
    fxLast,
    fxError: getLastFxRefreshError(),
    fxStale: shouldRefreshFxEvery8h(fxLast),
    stocksConfigured: true,
    stocksLast,
    stocksError: getLastStocksRefreshError(),
    stocksStale: shouldRefreshStocks(stocksLast),
    hasSecurities: hasSecuritiesForKpi
  };

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

  return (
    <div className="space-y-6">
      <PageHeader title="总览" description={<span className="tabular">{formatDate(todayCn())}</span>} actions={<><BaseCurrencyPicker current={baseCurrency} /><Link href="/assets/new" className="btn-primary"><Plus className="h-4 w-4" />新增资产</Link></>} />

      <section className="card dashboard-hero" aria-label="资产总览">
        <div className="net-worth-grid">
          <div className="net-worth-primary">
            <h2 className="net-worth-label">净资产</h2>
            <div className="net-worth-value tabular">{formatMoney(totalLatest, baseCurrency, 2)}</div>
            <NetWorthDelta change={latestChange} currency={baseCurrency} variant="plain" />
          </div>
          <div className="net-worth-metric">
            <h2 className="net-worth-label">总资产</h2>
            <div className="net-worth-metric-value tabular">{formatMoney(totalAssets, baseCurrency)}</div>
          </div>
          <div className="net-worth-metric">
            <h2 className="net-worth-label">累计变化</h2>
            <div className={`net-worth-metric-value tabular ${!firstSnap ? "text-ink-400" : totalSinceStart > 0 ? "text-gain-700" : totalSinceStart < 0 ? "text-loss-700" : "text-ink-900"}`}>
              {firstSnap ? `${totalSinceStart >= 0 ? "+" : ""}${formatMoney(totalSinceStart, baseCurrency)}` : "—"}
            </div>
            {firstSnap && <div className="net-worth-note">较首条快照 <span className="tabular">{formatPercent(totalSincePct)}</span></div>}
          </div>
          <div className="net-worth-metric">
            <h2 className="net-worth-label">证券当日</h2>
            <div className={`net-worth-metric-value tabular ${!hasTodayQuotes ? "text-ink-400" : todaySecPnL.totalBase > 0 ? "text-gain-700" : todaySecPnL.totalBase < 0 ? "text-loss-700" : "text-ink-900"}`}>
              {hasTodayQuotes ? `${todaySecPnL.totalBase > 0 ? "+" : ""}${formatMoney(todaySecPnL.totalBase, baseCurrency)}` : "—"}
            </div>
            <div className="net-worth-note">
              {!hasSecuritiesForKpi ? "暂无证券持仓" : hasTodayQuotes
                ? `${todaySecPnL.perAsset.size} 只${todaySecPnL.closedPositions.length ? "（含今日已移除持仓）" : ""}${todaySecPnL.status === "partial" ? " · 部分覆盖" : ""}`
                : weekend ? "休市或无可用会话日" : "无可用会话日"}
              {hasTodayQuotes && todaySecPnL.sessionDates.us && <span className="block tabular">美股交易日 {formatDate(todaySecPnL.sessionDates.us)}</span>}
            </div>
          </div>
        </div>

        {hasAssets && (
          <div className="portfolio-summary" aria-label="资产摘要">
            <div className="summary-metrics">
              <SummaryMetric
                label="总负债"
                tone="neutral"
                value={formatMoney(totalLiabilities, baseCurrency)}
                hint={hasLiabilities && totalAssets > 0
                  ? `负债率 ${formatPercent(totalLiabilities / totalAssets, 1)}`
                  : undefined}
              />
              <SummaryMetric
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
              {nativeShown.map((n) => <NativeTotalMetric key={n.code} code={n.code} value={n.value} count={n.count} />)}
            </div>
            {upcoming.length > 0 && (
              <div className="summary-maturity flex flex-wrap items-center gap-3 border-t border-hair text-[12px]">
                <span className="shrink-0 text-[12px] font-medium uppercase tracking-wider text-ink-400">
                  即将到期
                </span>
                <div className="min-w-0 flex-1 overflow-x-auto">
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
                <span className="shrink-0 text-[12px] text-ink-400">
                  60 天内 · {upcoming.length} 笔
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="dashboard-charts">
        <section className="card flex flex-col">
          <div className="card-body flex-1">
            <HistoryChart data={historyPoints} currency={baseCurrency} title="净值走势" />
          </div>
        </section>
        <section className="card flex flex-col">
          <div className="card-header gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="card-title shrink-0">资产分布</h2>

            </div>
            <Link
              href="/assets"
              className="inline-flex shrink-0 items-center gap-1 text-[12px] text-brand-600 hover:text-brand-700"
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
              compact
            />
          </div>
        </section>
      </div>

      {valuation.missingRates.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-gold-200 bg-gold-100 px-4 py-3 text-[14px] text-gold-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            部分汇率缺失：
            <span className="tabular font-medium">{valuation.missingRates.join("、")}</span>
            。请前往「设置 · 汇率」刷新或手动录入。
          </div>
        </div>
      )}
      <DataFreshnessBanner {...freshness} />

      {recentChanges.length > 0 && (
        <section className="card">
          <div className="card-header"><h2 className="card-title">最近变动</h2><Link href="/history" className="text-[13px] text-brand-600 hover:text-brand-700">查看全部 →</Link></div>
          <ul className="divide-y divide-hair/60 px-6">
            {recentChanges.slice(0, 3).map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-[13px]"><RecentChangeRow c={c} /></li>)}
          </ul>
        </section>
      )}

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
              <div className="min-w-0 text-[14px]">
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

function SummaryMetric({ label, value, hint, tone }: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone: "gain" | "loss" | "info" | "neutral" | "muted";
}) {
  const valueColor = {
    gain: "text-gain-700", loss: "text-loss-700", info: "text-ink-900",
    neutral: "text-ink-900", muted: "text-ink-400"
  }[tone];
  return (
    <div className="summary-metric">
      <h3 className="net-worth-label">{label}</h3>
      <div className={`net-worth-metric-value tabular ${valueColor}`}>{value}</div>
      {hint && <div className="net-worth-note">{hint}</div>}
    </div>
  );
}

function NativeTotalMetric({ code, value, count }: { code: string; value: number; count: number }) {
  const labels: Record<string, string> = { CNY: "人民币", USD: "美元", HKD: "港元" };
  return (
    <div className="summary-metric">
      <h3 className="net-worth-label">{labels[code] ?? code}<span className="ml-2 text-[11px] text-ink-400">{code}</span></h3>
      <div className={`summary-native-value tabular ${count === 0 ? "text-ink-400" : "text-ink-900"}`}>{formatMoney(value, code, 2)}</div>
      <div className="net-worth-note">原币 · {count} 笔</div>
    </div>
  );
}

/** 最近变动列表项。 */
function RecentChangeRow({
  c
}: {
  c: {
    id: number;
    action: string;
    asset_name: string | null;
    base_value_cny: number | null;
    created_at: string;
    field_changes: string | null;
  };
}) {
  let interest = false;
  if (c.field_changes) {
    try { interest = JSON.parse(c.field_changes)?.cash_flow_type?.to === "interest"; } catch { /* 损坏记录仍按普通变动展示 */ }
  }
  return (
    <>
      <ActionDot action={interest ? "create" : c.action} />
      <span className="font-medium text-ink-800">{interest ? "利息收入" : c.asset_name ?? "-"}</span>
      {interest && <span className="text-ink-500">{c.asset_name}</span>}
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
          <div className="mt-1 text-[14px] text-ink-500">
            {accountCount === 0
              ? "请先到「资产」页创建一个账户（例如：工行活期），再添加资产。"
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
