"use client";

import { CheckCircle2, RefreshCcw, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatCnDateTime } from "@/lib/time";
import type { StockAssetView, StockRefreshResult } from "@/lib/stocks";

interface Props {
  items: StockAssetView[];
  lastRefreshedAt: string | null;
  nextRefreshAt: string;
}

function formatMoney(n: number | null, currency: string): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  };
  return `${new Intl.NumberFormat("zh-CN", opts).format(n)} ${currency}`;
}

function diffBadge(prev: number | null, curr: number | null): { label: string; tone: "up" | "down" | "flat" } | null {
  if (prev == null || curr == null || !Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) {
    return null;
  }
  const diff = curr - prev;
  if (diff === 0) return { label: "持平", tone: "flat" };
  const pct = (diff / prev) * 100;
  const sign = diff > 0 ? "+" : "";
  return {
    label: `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,
    tone: diff > 0 ? "up" : "down"
  };
}

export function StockManager({ items, lastRefreshedAt, nextRefreshAt }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: "info" | "success" | "error" } | null>(null);
  const [result, setResult] = useState<StockRefreshResult | null>(null);

  async function refresh() {
    setMsg(null);
    setResult(null);
    try {
      const res = await fetch("/api/stocks?refresh=1", { method: "GET" });
      const raw = await res.text();
      type StocksApiResponse = {
        error?: string;
        refresh: StockRefreshResult | null;
      };
      let j: StocksApiResponse | null = null;
      if (raw.trim()) {
        try {
          j = JSON.parse(raw) as StocksApiResponse;
        } catch {
          setMsg({
            text: `服务器返回非 JSON（HTTP ${res.status}），请查看终端或部署日志`,
            tone: "error"
          });
          start(() => router.refresh());
          return;
        }
      }
      if (!j) {
        setMsg({
          text: `无响应内容（HTTP ${res.status}），多为请求超时或连接中断；持仓较多时请稍后再试或缩短刷新间隔`,
          tone: "error"
        });
        start(() => router.refresh());
        return;
      }
      if (!res.ok) {
        setMsg({
          text: j.error ?? `请求失败（HTTP ${res.status}）`,
          tone: "error"
        });
        if (j.refresh) setResult(j.refresh);
        start(() => router.refresh());
        return;
      }
      const r = j.refresh;
      setResult(r);
      if (r?.error) {
        setMsg({ text: r.error, tone: "error" });
      } else if (r?.skipped === "no_securities") {
        setMsg({ text: "当前没有需要刷新的证券资产（请先填写股票代码）", tone: "info" });
      } else if ((r?.updated_count ?? 0) > 0) {
        const failedPart = (r?.failed_count ?? 0) > 0 ? `，${r?.failed_count} 条失败` : "";
        setMsg({ text: `已更新 ${r?.updated_count} 条股票价格${failedPart}`, tone: "success" });
      } else if ((r?.failed_count ?? 0) > 0) {
        setMsg({ text: "全部更新失败，请稍后重试", tone: "error" });
      } else {
        setMsg({ text: "无需更新", tone: "info" });
      }
    } catch (e: any) {
      setMsg({ text: e?.message ?? "刷新失败", tone: "error" });
    }
    start(() => router.refresh());
  }

  const missingSymbolCount = items.filter((i) => !i.symbol || !i.market).length;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">股票价格</div>
        <button onClick={refresh} disabled={pending} className="btn-outline">
          <RefreshCcw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} /> 手动刷新
        </button>
      </div>
      <div className="card-body space-y-4">
        <div className="rounded-md bg-canvas-sunk/60 p-3 text-[12px] text-ink-500">
          <div>
            每天北京时间 <span className="font-semibold text-ink-700">10:00</span> 与{" "}
            <span className="font-semibold text-ink-700">14:00</span> 后各会触发一次自动刷新（在设置中已配置
            股票 AppKey 时生效）。需即时可点「手动刷新」。
          </div>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-ink-400">
            <span>
              上次自动刷新：
              <span className="tabular ml-1 text-ink-600">
                {lastRefreshedAt ? formatCnDateTime(lastRefreshedAt) : "暂无记录"}
              </span>
            </span>
            <span>
              下次计划刷新：
              <span className="tabular ml-1 text-ink-600">{formatCnDateTime(nextRefreshAt)}</span>
            </span>
          </div>
        </div>

        {missingSymbolCount > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-[12px] text-gold-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              有 {missingSymbolCount} 条证券资产尚未填写（或无法识别）股票代码，自动刷新会跳过它们，请到「资产」编辑页补充。
              格式示例：<span className="tabular">600519</span> · <span className="tabular">00700</span> ·{" "}
              <span className="tabular">AAPL</span>。
            </span>
          </div>
        )}

        {msg && (
          <div
            role={msg.tone === "error" ? "alert" : "status"}
            className={`rounded-md border px-3 py-2 text-[12px] ${
              msg.tone === "error"
                ? "border-loss-100 bg-loss-50 text-loss-700"
                : msg.tone === "success"
                  ? "border-gain-100 bg-gain-50 text-gain-700"
                  : "border-hair bg-canvas-sunk text-ink-500"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {msg.tone === "success" && <CheckCircle2 className="h-3.5 w-3.5" />}
              {msg.text}
            </span>
          </div>
        )}

        <div className="overflow-hidden rounded-md border border-hair">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">名称</th>
                <th className="text-left">代码</th>
                <th className="text-left">市场</th>
                <th className="text-right">当前价</th>
                <th className="text-right">本次变动</th>
                <th className="text-left">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink-400">
                    暂无证券类资产
                  </td>
                </tr>
              ) : (
                items.map((it) => {
                  const refItem = result?.items.find((x) => x.asset_id === it.asset_id);
                  const d = refItem
                    ? diffBadge(refItem.previous_price, refItem.fetched_price)
                    : null;
                  return (
                    <tr key={it.asset_id}>
                      <td>
                        <div className="font-medium text-ink-900">{it.name}</div>
                        <div className="mt-0.5 text-[11px] text-ink-400">{it.account_name}</div>
                      </td>
                      <td className="tabular">{it.symbol || <span className="text-ink-400">—</span>}</td>
                      <td>
                        {it.market_name ? (
                          <span className="chip chip-info">{it.market_name}</span>
                        ) : it.symbol ? (
                          <span className="chip chip-gold">代码无法识别</span>
                        ) : (
                          <span className="text-[12px] text-ink-400">未填</span>
                        )}
                      </td>
                      <td className="tabular text-right">
                        {formatMoney(it.current_price, it.currency)}
                      </td>
                      <td className="tabular text-right">
                        {refItem?.error ? (
                          <span className="text-[11px] text-loss-600">{refItem.error}</span>
                        ) : d ? (
                          <span
                            className={
                              d.tone === "up"
                                ? "text-gain-700"
                                : d.tone === "down"
                                  ? "text-loss-600"
                                  : "text-ink-500"
                            }
                          >
                            {d.label}
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="tabular text-[11px] text-ink-400">
                        {formatCnDateTime(it.updated_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
