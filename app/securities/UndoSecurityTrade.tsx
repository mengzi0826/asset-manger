"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { lastSecuritySubmission } from "@/lib/securityTradeUndo";
import { formatCnDateTime, formatMoney } from "@/lib/utils";

export type UndoTarget = NonNullable<ReturnType<typeof lastSecuritySubmission>>;

export function UndoSecurityTrade({ assetId, name, target, disabled }: {
  assetId: number; name: string; target: UndoTarget; disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  async function undo() {
    const cash = target.cashName && target.cashDelta != null
      ? `\n「${target.cashName}」将${target.cashDelta < 0 ? "退回" : "扣回"} ${formatMoney(Math.abs(target.cashDelta), target.currency)}。`
      : "";
    if (!window.confirm(`撤回「${name}」的${target.label}？\n${formatCnDateTime(target.at)} · ${formatMoney(target.amount, target.currency)}\n将恢复交易前的份额和成本。${cash}`)) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/assets/${assetId}/trade/undo`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: target.id })
      });
      if (!response.ok) setMessage((await response.json()).error ?? "撤回失败");
      startTransition(() => router.refresh());
    } catch {
      setMessage("无法确认撤回结果，请刷新后核对。");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button type="button" className="btn-outline" disabled={disabled || pending || refreshing} onClick={undo}>
        {pending ? "正在撤回…" : "撤回上次提交"}
      </button>
      {message && <p role="alert" className="mt-1 text-sm text-loss-700">{message}</p>}
    </div>
  );
}
