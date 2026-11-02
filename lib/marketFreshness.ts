import { getLastFxRefreshAt, getLastFxRefreshError } from "./fx";
import { getJuheFxAppKey } from "./juheKeys";
import { getLastStocksRefreshAt, getLastStocksRefreshError } from "./stocks";
import {
  isAnyStockMarketOpen,
  isWeekendBeijing,
  shouldRefreshFxEvery8h,
  shouldRefreshStocks,
  todayCn
} from "./time";

/** 底栏汇率/股价时间。页面首屏和轮询接口共用，避免两套判断。 */
export function getMarketFreshness() {
  const fxLast = getLastFxRefreshAt();
  const stocksLast = getLastStocksRefreshAt();
  return {
    weekend: isWeekendBeijing(todayCn()) && !isAnyStockMarketOpen(),
    fxConfigured: getJuheFxAppKey() !== "",
    fxLast,
    fxError: getLastFxRefreshError(),
    fxStale: shouldRefreshFxEvery8h(fxLast),
    stocksConfigured: true,
    stocksLast,
    stocksError: getLastStocksRefreshError(),
    stocksStale: shouldRefreshStocks(stocksLast)
  };
}
