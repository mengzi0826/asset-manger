import { getSetting } from "@/lib/db";
import { kickoffRatesRefresh, listRates } from "@/lib/fx";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { getFxKeyFieldState, getStockKeyFieldState } from "@/lib/juheKeys";
import {
  kickoffStockPricesRefresh,
  getLastStocksRefreshAt,
  listSecuritiesForView
} from "@/lib/stocks";
import { nextStockAutoRefreshIso } from "@/lib/time";
import { FxManager } from "./_components/FxManager";
import { JuheApiKeyForm } from "./_components/JuheApiKeyForm";
import { StockManager } from "./_components/StockManager";
import { BaseCurrencyPicker } from "../_components/BaseCurrencyPicker";
import { BackupPanel } from "./_components/BackupPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  kickoffRatesRefresh();
  kickoffStockPricesRefresh();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const rates = listRates();
  const stockItems = listSecuritiesForView();
  const lastStocksRefreshAt = getLastStocksRefreshAt();
  const nextRefreshAt = nextStockAutoRefreshIso();
  const juheFxState = getFxKeyFieldState();
  const juheStockState = getStockKeyFieldState();

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">偏好设置</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900">设置</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">
          基准货币 · 聚合数据 AppKey · 汇率与股票价格 · 数据备份
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">基准货币</div>
        </div>
        <div className="card-body flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-ink-500">
            总览、历史曲线以此货币结算。当前：
            <span className="tabular ml-1 font-semibold text-ink-900">{baseCurrency}</span>
          </div>
          <BaseCurrencyPicker current={baseCurrency} />
        </div>
      </div>

      <JuheApiKeyForm fx={juheFxState} stock={juheStockState} />

      <FxManager rates={rates} supported={[...SUPPORTED_CURRENCIES]} />

      <StockManager
        items={stockItems}
        lastRefreshedAt={lastStocksRefreshAt}
        nextRefreshAt={nextRefreshAt}
      />

      <BackupPanel />
    </div>
  );
}
