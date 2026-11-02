import { PageHeader } from "@/components/PageHeader";
import { getSetting } from "@/lib/db";
import { kickoffRatesRefresh, listRates } from "@/lib/fx";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { getFxKeyFieldState, getStockKeyFieldState } from "@/lib/juheKeys";
import {
  kickoffStockPricesRefresh,
  getLastStocksRefreshAt,
  listRecentStockRefreshLogs,
  listSecuritiesForView
} from "@/lib/stocks";
import { nextStockAutoRefreshIso } from "@/lib/time";
import { accrueTodayInterest, getInterestStatus } from "@/lib/interest";
import { FxManager } from "./_components/FxManager";
import { InterestRateForm } from "./_components/InterestRateForm";
import { JuheApiKeyForm } from "./_components/JuheApiKeyForm";
import { StockManager } from "./_components/StockManager";
import { BaseCurrencyPicker } from "../_components/BaseCurrencyPicker";
import { BackupPanel } from "./_components/BackupPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  kickoffRatesRefresh();
  kickoffStockPricesRefresh();
  accrueTodayInterest();
  const interest = getInterestStatus();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const rates = listRates();
  const stockItems = listSecuritiesForView();
  const lastStocksRefreshAt = getLastStocksRefreshAt();
  const nextRefreshAt = nextStockAutoRefreshIso(lastStocksRefreshAt);
  const stockRefreshFailures = listRecentStockRefreshLogs({ limit: 30, failuresOnly: true });
  const juheFxState = getFxKeyFieldState();
  const juheStockState = getStockKeyFieldState();

  return (
    <div className="space-y-6">
      <PageHeader title="设置" />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区"><a href="#preferences">显示偏好</a><a href="#interest">利息收入</a><a href="#keys">数据来源</a><a href="#fx">汇率管理</a><a href="#stocks">股票行情</a><a href="#backup">备份与恢复</a></nav>
        <div className="settings-content">
      <section id="preferences" aria-label="显示偏好">
      <div className="card">
        <div className="card-header">
          <div className="card-title">基准货币</div>
        </div>
        <div className="card-body flex flex-wrap items-center justify-between gap-3">
          <div className="text-[14px] text-ink-500">
            总览、历史曲线以此货币结算。当前：
            <span className="tabular ml-1 font-semibold text-ink-900">{baseCurrency}</span>
          </div>
          <BaseCurrencyPicker current={baseCurrency} />
        </div>
      </div>

      </section>
      <section id="interest" aria-label="利息收入"><InterestRateForm buckets={interest} /></section>
      <section id="keys" aria-label="数据来源"><JuheApiKeyForm fx={juheFxState} stock={juheStockState} /></section>

      <section id="fx" aria-label="汇率管理"><FxManager rates={rates} supported={[...SUPPORTED_CURRENCIES]} /></section>

      <section id="stocks" aria-label="股票行情"><StockManager
        items={stockItems}
        lastRefreshedAt={lastStocksRefreshAt}
        nextRefreshAt={nextRefreshAt}
        refreshFailures={stockRefreshFailures}
      /></section>

      <section id="backup" aria-label="备份与恢复"><BackupPanel /></section>
        </div>
      </div>
    </div>
  );
}
