"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { INTEREST_DAY_COUNT, dailyInterest, type InterestBucketStatus } from "@/lib/interestMath";
import { formatMoney } from "@/lib/utils";

function percentText(rate: number) {
  return String(Math.round(rate * 1e8) / 1e6);
}

export function InterestRateForm({ buckets }: { buckets: InterestBucketStatus[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(buckets.map((bucket) => [bucket.id, percentText(bucket.annualRate)]))
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMsg(null);
    const body: Record<string, number> = {};
    for (const bucket of buckets) {
      const value = Number(rates[bucket.id]);
      if (!Number.isFinite(value) || value < 0 || value > 500) {
        setMsg({ text: `${bucket.label}的年化利率需在 0% 到 500% 之间`, error: true });
        return;
      }
      body[bucket.id] = value / 100;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interest_rates: body })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg({ text: j.error ?? "保存失败", error: true });
        return;
      }
      setMsg({ text: "已保存。今日利息已按当前年化利率入账。", error: false });
      start(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || pending;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">利息收入</div>
      </div>
      <form onSubmit={onSubmit} className="card-body space-y-4">
        <p className="text-[13px] leading-relaxed text-ink-500">
          人民币、港币、美元按对应现金余额计息，加密货币按美元计价的加密资产计息。存款、基金和证券不计入。
          日息 = 计息本金 × 年化利率 / {INTEREST_DAY_COUNT}，四舍五入到分。每个北京日计息一次，利息账户余额次日计入本金。
          电脑休眠或关机错过的日期，下次进程恢复时按休眠前余额逐日补记，并记到对应日期。修改当日利率只重算今天。
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {buckets.map((bucket) => {
            const typed = Number(rates[bucket.id]);
            const savedPercent = bucket.annualRate * 100;
            const dirty = Number.isFinite(typed) && Math.abs(typed - savedPercent) > 1e-8;
            const preview = Number.isFinite(typed) ? dailyInterest(bucket.principal, typed / 100) : null;
            const shown = dirty ? preview : bucket.todayInterest;
            return (
              <div key={bucket.id} className="rounded-md bg-canvas-sunk/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[14px] font-medium text-ink-900">{bucket.label}</div>
                  <span className="chip tabular">{bucket.currency}</span>
                </div>
                <label className="label mt-3" htmlFor={`interest-${bucket.id}`}>年化利率（%）</label>
                <input
                  id={`interest-${bucket.id}`}
                  className="input tabular"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  max="500"
                  step="0.01"
                  value={rates[bucket.id] ?? ""}
                  onChange={(e) => setRates({ ...rates, [bucket.id]: e.target.value })}
                />
                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-ink-500">
                  <span>计息本金 <span className="tabular font-medium text-ink-800">{formatMoney(bucket.principal, bucket.currency)}</span></span>
                  <span>
                    {dirty ? "今日预览" : bucket.accrued ? "今日已入账" : "今日利息"}{" "}
                    <span className="tabular font-medium text-ink-800">
                      {shown == null ? "—" : formatMoney(shown, bucket.currency)}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {msg && (
          <div role="alert" className={`rounded-md border px-3.5 py-2.5 text-[14px] ${msg.error ? "border-gain-100 bg-gain-50 text-gain-700" : "border-hair bg-canvas-sunk text-ink-700"}`}>
            {msg.text}
          </div>
        )}
        <button className="btn-primary" disabled={busy}>
          <Save className="h-3.5 w-3.5" /> {busy ? "保存中…" : "保存利率"}
        </button>
      </form>
    </div>
  );
}
