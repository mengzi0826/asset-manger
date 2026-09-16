"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import type { CashFlowEntry } from "@/lib/history";
import { formatCnDateTime, formatMoney } from "@/lib/utils";

type FlowType = "deposit" | "expense";

export function CashFlowPanel({
  assetId,
  assetName,
  currency,
  currentAmount,
  entries
}: {
  assetId: number;
  assetName: string;
  currency: string;
  currentAmount: number;
  entries: CashFlowEntry[];
}) {
  const router = useRouter();
  const [type, setType] = useState<FlowType>("deposit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const hasAmount = amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const nextAmount = hasAmount
    ? currentAmount + (type === "deposit" ? amountNum : -amountNum)
    : null;
  const insufficient = type === "expense" && nextAmount != null && nextAmount < -1e-9;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hasAmount) return setError("请填写大于 0 的金额");
    if (!reason.trim()) return setError("请填写现金变化的原因");
    if (insufficient) return setError("消费金额超过当前现金余额");

    setPending(true);
    try {
      const res = await fetch(`/api/assets/${assetId}/cash-flow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, amount: amountNum, reason: reason.trim() })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return setError(j.error ?? "现金变动记录失败");
      }
      setAmount("");
      setReason("");
      router.refresh();
    } catch {
      setError("现金变动记录失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">现金流（入金 / 消费）</div>
          <p className="mt-1 text-[11px] text-ink-400">记录金额和原因，便于日后复盘余额变化</p>
        </div>
        <span className="chip tabular">当前 {formatMoney(currentAmount, currency, 2)}</span>
      </div>
      <div className="card-body space-y-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="inline-flex rounded-md border border-hair p-0.5">
            <button
              type="button"
              onClick={() => {
                setType("deposit");
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium transition ${
                type === "deposit" ? "bg-gain-50 text-gain-700" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <ArrowDownLeft className="h-3.5 w-3.5" /> 入金
            </button>
            <button
              type="button"
              onClick={() => {
                setType("expense");
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium transition ${
                type === "expense" ? "bg-loss-50 text-loss-700" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> 消费
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label={`金额（${currency}）`} required>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                className="input tabular"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="原因" required hint="例如：工资到账、餐饮、房租、信用卡还款">
              <input
                type="text"
                maxLength={200}
                className="input"
                placeholder={type === "deposit" ? "这笔入金从哪里来？" : "这笔消费用在什么地方？"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hair bg-canvas-inset px-3.5 py-3 text-[12px]">
            <div className="tabular text-ink-600">
              操作后余额：{" "}
              <span className={insufficient ? "font-medium text-loss-700" : "font-medium text-ink-900"}>
                {nextAmount != null ? formatMoney(nextAmount, currency, 2) : "—"}
              </span>
            </div>
            <button
              className={type === "deposit" ? "btn-primary" : "btn-danger"}
              disabled={pending || insufficient}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              确认{type === "deposit" ? "入金" : "消费"}「{assetName}」
            </button>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-loss-100 bg-loss-50 px-3.5 py-2.5 text-[13px] text-loss-700">
              {error}
            </div>
          )}
        </form>

        <div className="border-t border-hair pt-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="text-[12px] font-medium text-ink-700">最近现金流</div>
            <span className="text-[11px] text-ink-400">{entries.length} 条</span>
          </div>
          {entries.length === 0 ? (
            <div className="rounded-md bg-canvas-sunk/60 px-3 py-5 text-center text-[12px] text-ink-400">
              暂无入金或消费记录
            </div>
          ) : (
            <ul className="divide-y divide-hair rounded-md border border-hair px-3.5">
              {entries.map((entry) => {
                const isDeposit = entry.type === "deposit";
                return (
                  <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[12px]">
                    <span className={isDeposit ? "chip chip-gain" : "chip chip-loss"}>
                      {isDeposit ? "入金" : "消费"}
                    </span>
                    <span className="min-w-0 flex-1 text-ink-700">{entry.reason}</span>
                    <span className={`tabular font-medium ${isDeposit ? "text-gain-700" : "text-loss-700"}`}>
                      {isDeposit ? "+" : "-"}{formatMoney(Math.abs(entry.amount), currency, 2)}
                    </span>
                    <span className="tabular basis-full text-right text-[11px] text-ink-400 sm:basis-auto">
                      {formatCnDateTime(entry.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  hint
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="ml-1 text-loss-600">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-400">{hint}</p>}
    </div>
  );
}
