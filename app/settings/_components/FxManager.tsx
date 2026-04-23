"use client";

import { RefreshCcw, Save, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FxRate } from "@/lib/db";
import { formatCnDateTime } from "@/lib/time";

export function FxManager({ rates, supported }: { rates: FxRate[]; supported: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: "info" | "success" | "error" } | null>(null);
  const [form, setForm] = useState({ base: "USD", quote: "CNY", rate: "" });

  async function refresh() {
    setMsg(null);
    const res = await fetch("/api/fx?refresh=1");
    const j = await res.json();
    if (j.refresh?.error) {
      setMsg({ text: j.refresh.error, tone: "error" });
    } else {
      setMsg({ text: j.refresh?.updated ? "汇率已刷新" : "已拉取（数据与之前一致或已写入）", tone: "success" });
    }
    start(() => router.refresh());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const rate = Number(form.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      setMsg({ text: "请输入合法汇率（大于 0）", tone: "error" });
      return;
    }
    const res = await fetch("/api/fx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base: form.base, quote: form.quote, rate })
    });
    if (res.ok) {
      setMsg({ text: `已手动设置 ${form.base} → ${form.quote} = ${rate}`, tone: "success" });
      setForm({ ...form, rate: "" });
      start(() => router.refresh());
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg({ text: j.error ?? "保存失败", tone: "error" });
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">汇率管理</div>
        <button onClick={refresh} disabled={pending} className="btn-outline">
          <RefreshCcw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} /> 刷新
        </button>
      </div>
      <div className="card-body space-y-5">
        <p className="text-[12px] leading-relaxed text-ink-500">
          每 <span className="font-medium text-ink-700">8 小时</span> 自动从聚合数据拉取一次；访问页面时会触发该逻辑（已配置汇率
          AppKey 时有效）。下表「手动保存」的汇率以「手动」来源为准。
        </p>
        <form
          onSubmit={submit}
          className="grid grid-cols-1 items-end gap-3 rounded-md bg-canvas-sunk/60 p-4 md:grid-cols-12"
        >
          <div className="md:col-span-2">
            <label className="label">源币种</label>
            <select
              className="input tabular"
              value={form.base}
              onChange={(e) => setForm({ ...form, base: e.target.value })}
            >
              {supported.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">目标</label>
            <select
              className="input tabular"
              value={form.quote}
              onChange={(e) => setForm({ ...form, quote: e.target.value })}
            >
              {supported.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-5">
            <label className="label">
              汇率（1 {form.base} = N {form.quote}）
            </label>
            <input
              type="number"
              step="0.000001"
              inputMode="decimal"
              className="input tabular"
              placeholder="如 7.2"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              required
            />
          </div>
          <div className="md:col-span-3">
            <button className="btn-primary w-full" disabled={pending}>
              <Save className="h-3.5 w-3.5" /> 保存手动汇率
            </button>
          </div>
        </form>

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
                <th className="text-left">源</th>
                <th className="text-left">目标</th>
                <th className="text-right">汇率</th>
                <th className="text-left">来源</th>
                <th className="text-left">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-ink-400">
                    暂无汇率，请点击「刷新」
                  </td>
                </tr>
              ) : (
                rates.map((r) => (
                  <tr key={`${r.base}-${r.quote}`}>
                    <td className="tabular">{r.base}</td>
                    <td className="tabular">{r.quote}</td>
                    <td className="tabular text-right">{r.rate.toFixed(6)}</td>
                    <td>
                      <span
                        className={`chip ${
                          r.source === "manual" ? "chip-gold" : "chip-info"
                        }`}
                      >
                        {r.source === "manual" ? "手动" : "自动"}
                      </span>
                    </td>
                    <td className="tabular text-[11px] text-ink-400">
                      {formatCnDateTime(r.fetched_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
