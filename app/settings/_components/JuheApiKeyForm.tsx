"use client";

import { KeyRound, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { KeyFieldState } from "@/lib/juheKeys";

export function JuheApiKeyForm({
  fx,
  stock
}: {
  fx: KeyFieldState;
  stock: KeyFieldState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [fxInput, setFxInput] = useState("");
  const [stockInput, setStockInput] = useState("");
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    setMsg(null);
    const body: Record<string, string | null> = {};
    if (fxInput.trim() !== "") body.juhe_fx_appkey = fxInput.trim();
    if (stockInput.trim() !== "") body.juhe_stock_appkey = stockInput.trim();
    if (Object.keys(body).length === 0) {
      setMsg({ text: "请输入至少一个 Key 再保存，或使用「仅清除某一项」的链接。", error: true });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg({ text: j.error ?? "保存失败", error: true });
        return;
      }
      setFxInput("");
      setStockInput("");
      setMsg({ text: "已保存。汇率与股票价格将使用新 Key（数据库优先于环境变量）。", error: false });
      start(() => router.refresh());
    } finally {
      setIsSaving(false);
    }
  }

  async function clearKey(which: "fx" | "stock") {
    if (isSaving) return;
    if (!confirm(`确定从数据库中清除${which === "fx" ? "汇率" : "股票"} AppKey 配置？\n将回退为仅环境变量（若已设置）。`)) {
      return;
    }
    setMsg(null);
    setIsSaving(true);
    try {
      const body = which === "fx" ? { juhe_fx_appkey: null } : { juhe_stock_appkey: null };
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg({ text: j.error ?? "清除失败", error: true });
        return;
      }
      setMsg({ text: "已清除数据库中的 Key。", error: false });
      start(() => router.refresh());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">聚合数据 AppKey</div>
        <KeyRound className="h-4 w-4 text-ink-400" />
      </div>
      <div className="card-body space-y-4">
        <div className="space-y-2 text-[13px] leading-relaxed text-ink-600">
          <p>
            在{" "}
            <a
              className="font-medium text-gold-700 underline underline-offset-2 hover:text-gold-800"
              href="https://www.juhe.cn/"
              target="_blank"
              rel="noreferrer"
            >
              聚合数据
            </a>{" "}
            为各接口开通服务后即可获取 AppKey；不同数据源对应不同接口，因此需要使用不同的 AppKey。
          </p>
          {/* 注释说明：环境变量与本页保存的优先级 */}
          <p className="border-l-2 border-hair pl-3 text-[11px] leading-relaxed text-ink-400">
            也可通过环境变量来配置{" "}
            <code className="tabular rounded bg-canvas-sunk px-1 py-0.5 font-mono text-[10px] text-ink-500">
              JUHE_FX_APPKEY
            </code>{" "}
            与{" "}
            <code className="tabular rounded bg-canvas-sunk px-1 py-0.5 font-mono text-[10px] text-ink-500">
              JUHE_STOCK_APPKEY
            </code>
            ；本页保存过的值会优先生效；想改回只用环境变量时，点对应栏右侧的「清除」即可。
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="input-fx-appkey" className="label">汇率（全球汇率查询换算）</label>
              {fx.source === "database" && (
                <button
                  type="button"
                  onClick={() => void clearKey("fx")}
                  disabled={isSaving}
                  className="text-[11px] text-ink-400 underline"
                >
                  清除
                </button>
              )}
            </div>
            <input
              id="input-fx-appkey"
              type="password"
              className="input font-mono text-[12px]"
              autoComplete="off"
              placeholder={fx.source === "database" && fx.mask ? "留空不修改" : "粘贴 AppKey"}
              value={fxInput}
              onChange={(e) => setFxInput(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-ink-400">
              汇率每 8 小时自动拉取一次。{keyHelp(fx, "JUHE_FX_APPKEY")}
            </p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="input-stock-appkey" className="label">股票价格（沪深 / 港股 / 美股）</label>
              {stock.source === "database" && (
                <button
                  type="button"
                  onClick={() => void clearKey("stock")}
                  disabled={isSaving}
                  className="text-[11px] text-ink-400 underline"
                >
                  清除
                </button>
              )}
            </div>
            <input
              id="input-stock-appkey"
              type="password"
              className="input font-mono text-[12px]"
              autoComplete="off"
              placeholder={stock.source === "database" && stock.mask ? "留空不修改" : "粘贴 AppKey"}
              value={stockInput}
              onChange={(e) => setStockInput(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-ink-400">
              每天北京时间 10:00、14:00 后进入应用各最多自动拉取一次。{keyHelp(stock, "JUHE_STOCK_APPKEY")}
            </p>
          </div>
          <button className="btn-primary" disabled={isSaving || pending} type="submit">
            <Save className="h-3.5 w-3.5" /> 保存
          </button>
        </form>
        {msg && (
          <div
            role={msg.error ? "alert" : "status"}
            className={`rounded-md border px-3 py-2 text-[12px] ${
              msg.error
                ? "border-loss-100 bg-loss-50 text-loss-700"
                : "border-gain-100 bg-gain-50 text-gain-700"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

function keyHelp(f: KeyFieldState, envName: string): string {
  if (f.source === "env" && f.effective_configured) {
    return `当前使用 ${envName} 环境变量；可在此覆盖为数据库中保存的 Key。`;
  }
  if (f.source === "database" && f.mask) {
    return `已保存 ${f.mask}，留空不修改。`;
  }
  return f.effective_configured ? "已可拉取。" : "未配置。";
}
