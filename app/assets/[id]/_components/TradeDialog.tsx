"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { formatMoney } from "@/lib/utils";

export interface CashAssetOption {
  id: number;
  name: string;
  amount: number;
  currency: string;
}

type Side = "buy" | "sell";

export function TradeDialog({
  assetId,
  assetName,
  currency,
  currentQuantity,
  currentUnitCost,
  currentPrice,
  cashAssets
}: {
  assetId: number;
  assetName: string;
  currency: string;
  currentQuantity: number;
  currentUnitCost: number | null;
  currentPrice: number | null;
  cashAssets: CashAssetOption[];
}) {
  const router = useRouter();
  const [side, setSide] = useState<Side>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(
    currentPrice != null ? String(currentPrice) : currentUnitCost != null ? String(currentUnitCost) : ""
  );
  const [unitCost, setUnitCost] = useState("");
  const [unitCostTouched, setUnitCostTouched] = useState(false);
  const [cashAssetId, setCashAssetId] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qtyNum = Number(quantity);
  const priceNum = Number(price);
  const hasQty = quantity !== "" && Number.isFinite(qtyNum) && qtyNum > 0;
  const hasPrice = price !== "" && Number.isFinite(priceNum) && priceNum >= 0;

  // 建议均价：增持=加权均价；减持=沿用当前均价。用户改过后以用户为准。
  const suggestedUnitCost = useMemo(() => {
    const c = currentUnitCost ?? 0;
    if (side === "sell") return currentUnitCost != null ? currentUnitCost : null;
    if (!hasQty || !hasPrice) return currentUnitCost;
    const q = currentQuantity;
    const denom = q + qtyNum;
    if (denom <= 0) return priceNum;
    return (q * c + qtyNum * priceNum) / denom;
  }, [side, hasQty, hasPrice, qtyNum, priceNum, currentQuantity, currentUnitCost]);

  const effectiveUnitCost = unitCostTouched
    ? unitCost
    : suggestedUnitCost != null
    ? String(round(suggestedUnitCost, 6))
    : "";

  const tradeValue = hasQty && hasPrice ? qtyNum * priceNum : null;
  const nextQuantity = hasQty ? (side === "buy" ? currentQuantity + qtyNum : currentQuantity - qtyNum) : null;

  const selectedCash = cashAssets.find((c) => String(c.id) === cashAssetId);
  const nextCashBalance =
    selectedCash && tradeValue != null
      ? selectedCash.amount + (side === "buy" ? -tradeValue : tradeValue)
      : null;

  const sellExceeds = side === "sell" && nextQuantity != null && nextQuantity < -1e-9;
  const cashInsufficient =
    side === "buy" && selectedCash != null && tradeValue != null && tradeValue > selectedCash.amount + 1e-9;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hasQty) return setError("请填写成交股数");
    if (!hasPrice) return setError("请填写成交价");
    const finalUnitCost = Number(effectiveUnitCost);
    if (!Number.isFinite(finalUnitCost) || finalUnitCost < 0) return setError("均价无效");
    if (sellExceeds) return setError("减持股数超过当前持仓");
    if (cashInsufficient) return setError("现金余额不足");

    setPending(true);
    const res = await fetch(`/api/assets/${assetId}/trade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        side,
        quantity: qtyNum,
        price: priceNum,
        unit_cost: finalUnitCost,
        cash_asset_id: cashAssetId === "" ? null : Number(cashAssetId)
      })
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "交易失败");
      setPending(false);
      return;
    }
    setPending(false);
    setQuantity("");
    setUnitCost("");
    setUnitCostTouched(false);
    setCashAssetId("");
    router.refresh();
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">交易（增持 / 减持）</div>
        <span className="chip tabular">
          当前 {currentQuantity} 股 · 均价 {currentUnitCost != null ? round(currentUnitCost, 4) : "—"} {currency}
        </span>
      </div>
      <form onSubmit={submit} className="card-body space-y-4">
        {/* 方向切换 */}
        <div className="inline-flex rounded-md border border-hair p-0.5">
          <button
            type="button"
            onClick={() => setSide("buy")}
            className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium transition ${
              side === "buy" ? "bg-gain-50 text-gain-700" : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" /> 增持（买入）
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium transition ${
              side === "sell" ? "bg-loss-50 text-loss-700" : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <TrendingDown className="h-3.5 w-3.5" /> 减持（卖出）
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="成交股数" required>
            <input
              type="number"
              step="0.00000001"
              inputMode="decimal"
              className="input tabular"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label={`成交价（${currency}）`} required>
            <input
              type="number"
              step="0.0001"
              inputMode="decimal"
              className="input tabular"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field
            label={`成交后均价（${currency}）`}
            hint="已按公式给出建议值，可自行修改，最终以此为准"
          >
            <input
              type="number"
              step="0.0001"
              inputMode="decimal"
              className="input tabular"
              value={effectiveUnitCost}
              onChange={(e) => {
                setUnitCost(e.target.value);
                setUnitCostTouched(true);
              }}
            />
          </Field>
        </div>

        {/* 现金账户（可选） */}
        <Field
          label={side === "buy" ? "扣款现金账户（可选）" : "入账现金账户（可选）"}
          hint={`仅展示 ${currency} 现金资产；不选则不调整现金`}
        >
          <select
            className="input"
            value={cashAssetId}
            onChange={(e) => setCashAssetId(e.target.value)}
          >
            <option value="">不调整现金</option>
            {cashAssets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（余额 {round(c.amount, 2)} {c.currency}）
              </option>
            ))}
          </select>
        </Field>

        {/* 预览 */}
        <div className="rounded-md border border-hair bg-canvas-inset px-3.5 py-3 text-[12px] tabular">
          <div className="grid grid-cols-2 gap-y-1.5 sm:grid-cols-4">
            <Preview label="成交额" value={tradeValue != null ? formatMoney(tradeValue, currency, 2) : "—"} />
            <Preview
              label="成交后股数"
              value={nextQuantity != null ? round(nextQuantity, 6) : "—"}
              danger={sellExceeds}
            />
            <Preview
              label={side === "buy" ? "现金扣减后" : "现金入账后"}
              value={
                selectedCash
                  ? nextCashBalance != null
                    ? formatMoney(nextCashBalance, currency, 2)
                    : formatMoney(selectedCash.amount, currency, 2)
                  : "不调整"
              }
              danger={cashInsufficient}
            />
            <Preview
              label="本次方向"
              value={side === "buy" ? "增持" : "减持"}
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-loss-100 bg-loss-50 px-3.5 py-2.5 text-[13px] text-loss-700"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            className={side === "buy" ? "btn-primary" : "btn-danger"}
            disabled={pending || sellExceeds || cashInsufficient}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认{side === "buy" ? "增持" : "减持"}「{assetName}」
          </button>
        </div>
      </form>
    </div>
  );
}

function round(n: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
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

function Preview({
  label,
  value,
  danger
}: {
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-0.5 font-medium ${danger ? "text-loss-700" : "text-ink-900"}`}>{value}</div>
    </div>
  );
}
