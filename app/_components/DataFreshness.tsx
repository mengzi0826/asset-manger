import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { formatCnDateTime, formatCnDateTimeMinute } from "@/lib/utils";

export interface DataFreshnessProps {
  weekend: boolean;
  fxConfigured: boolean;
  fxLast: string | null;
  fxError: string | null;
  fxStale: boolean;
  stocksConfigured: boolean;
  stocksLast: string | null;
  stocksError: string | null;
  stocksStale: boolean;
  hasSecurities: boolean;
}

function stamp(iso: string | null): string {
  return iso ? formatCnDateTime(iso) : "—";
}

function stockStamp(iso: string | null): string {
  return iso ? formatCnDateTimeMinute(iso) : "—";
}

function warningsOf(props: DataFreshnessProps): string[] {
  const {
    weekend,
    fxConfigured,
    fxStale,
    fxError,
    stocksError,
    stocksStale,
    stocksLast,
    hasSecurities
  } = props;
  const warnings: string[] = [];
  if (fxError) warnings.push(`汇率：${fxError}`);
  else if (fxStale && fxConfigured) {
    warnings.push("汇率已超过 8 小时未自动更新，当前换算可能不是最新。");
  }
  if (stocksError) warnings.push(`股价：${stocksError}`);
  else if (stocksStale && hasSecurities && !weekend) {
    warnings.push(
      stocksLast
        ? `股价仍是 ${stockStamp(stocksLast)} 的数据，开市后尚未更新成功。`
        : "尚未成功拉取过股票价格。"
    );
  }
  return warnings;
}

/** 全站底栏：汇率 / 股价时间戳 */
export function DataFreshnessLine(props: Omit<DataFreshnessProps, "hasSecurities">) {
  const {
    weekend,
    fxConfigured,
    fxLast,
    fxError,
    fxStale,
    stocksConfigured,
    stocksLast,
    stocksError,
    stocksStale
  } = props;
  return (
    <div className="market-freshness">
      <span>
        汇率更新{" "}
        <span className={`tabular ${fxError || fxStale ? "text-gold-700" : "text-ink-600"}`}>
          {!fxConfigured ? "未配置" : stamp(fxLast)}
        </span>
      </span>
      <span>
        股价更新{" "}
        <span
          className={`tabular ${stocksError || (stocksStale && !weekend) ? "text-gold-700" : "text-ink-600"}`}
        >
          {!stocksConfigured ? "未配置" : stockStamp(stocksLast)}
        </span>
      </span>
      {weekend && (
        <span>周末休市</span>
      )}
    </div>
  );
}

/** 汇率/股价过期或上次拉取失败时的提示条 */
export function DataFreshnessBanner(props: DataFreshnessProps) {
  const warnings = warningsOf(props);
  if (warnings.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-gold-200 bg-gold-100 px-4 py-3 text-[14px] text-gold-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        {warnings.map((w) => (
          <div key={w}>{w}</div>
        ))}
        <Link href="/settings" className="text-[13px] font-medium text-gold-700 hover:text-gold-600">
          去设置查看或手动刷新
        </Link>
      </div>
    </div>
  );
}
