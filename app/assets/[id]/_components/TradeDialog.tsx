"use client";

import { UndoSecurityTrade, type UndoTarget } from "@/app/securities/UndoSecurityTrade";

import { cloneElement, isValidElement, useId } from "react";

import { useConfirm } from "@/components/ui/ConfirmProvider";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Loader2, LogOut, TrendingDown, TrendingUp } from "lucide-react";
import type { SecurityTradeEntry, SecurityTradeKind } from "@/lib/portfolioEvents";
import { formatCnDateTime, formatMoney } from "@/lib/utils";

export interface CashAssetOption {
  id: number;
  name: string;
  amount: number;
  currency: string;
}

type Side = "buy" | "sell" | "close" | "dividend";

export function TradeDialog({
  assetId,
  assetName,
  currency,
  currentQuantity,
  currentUnitCost,
  currentPrice,
  cashAssets,
  trades, undoTarget
}: {
  assetId: number;
  assetName: string;
  currency: string;
  currentQuantity: number;
  currentUnitCost: number | null;
  currentPrice: number | null;
  cashAssets: CashAssetOption[];
  trades: SecurityTradeEntry[];
  undoTarget: UndoTarget | null;
}) {
  const router = useRouter();
  const confirmAction = useConfirm();
  const [side, setSide] = useState<Side>("buy");
  const [quantity, setQuantity] = useState("");
  const [dividendAmount, setDividendAmount] = useState("");
  const [price, setPrice] = useState(
    currentPrice != null ? String(currentPrice) : currentUnitCost != null ? String(currentUnitCost) : ""
  );
  const [unitCost, setUnitCost] = useState("");
  const [unitCostTouched, setUnitCostTouched] = useState(false);
  const [cashAssetId, setCashAssetId] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClose = side === "close";
  const isDividend = side === "dividend";
  const dividendNum = Number(dividendAmount);
  const hasDividendAmount =
    dividendAmount !== "" && Number.isFinite(dividendNum) && dividendNum > 0;
  const priceNum = Number(price);
  const hasPrice = price !== "" && Number.isFinite(priceNum) && priceNum >= 0;
  // 清仓固定为「全部剩余股数」，不需要用户填股数
  const qtyNum = isClose ? currentQuantity : Number(quantity);
  const hasQty = isClose
    ? currentQuantity > 0
    : quantity !== "" && Number.isFinite(qtyNum) && qtyNum > 0;

  // 建议均价：增持=加权均价；减持=沿用当前均价；分红=扣除每股到账额。
  const suggestedUnitCost = useMemo(() => {
    const c = currentUnitCost ?? 0;
    if (side === "dividend") {
      if (!hasDividendAmount || currentQuantity <= 0 || currentUnitCost == null) return currentUnitCost;
      return Math.max(0, currentUnitCost - dividendNum / currentQuantity);
    }
    if (side === "sell") return currentUnitCost != null ? currentUnitCost : null;
    if (!hasQty || !hasPrice) return currentUnitCost;
    const q = currentQuantity;
    const denom = q + qtyNum;
    if (denom <= 0) return priceNum;
    return (q * c + qtyNum * priceNum) / denom;
  }, [
    side,
    hasDividendAmount,
    dividendNum,
    hasQty,
    hasPrice,
    qtyNum,
    priceNum,
    currentQuantity,
    currentUnitCost
  ]);

  const effectiveUnitCost = unitCostTouched
    ? unitCost
    : suggestedUnitCost != null
    ? String(round(suggestedUnitCost, 6))
    : "";

  const tradeValue = isDividend
    ? hasDividendAmount
      ? dividendNum
      : null
    : hasQty && hasPrice
      ? qtyNum * priceNum
      : null;
  const nextQuantity = hasQty
    ? side === "buy"
      ? currentQuantity + qtyNum
      : side === "close"
        ? 0
        : currentQuantity - qtyNum
    : null;

  const selectedCash = cashAssets.find((c) => String(c.id) === cashAssetId);
  const nextCashBalance =
    selectedCash && tradeValue != null
      ? selectedCash.amount + (side === "buy" ? -tradeValue : tradeValue)
      : null;

  const sellExceeds = side === "sell" && nextQuantity != null && nextQuantity < -1e-9;
  const cashInsufficient =
    side === "buy" && selectedCash != null && tradeValue != null && tradeValue > selectedCash.amount + 1e-9;

  function selectSide(next: Side) {
    setSide(next);
    setUnitCost("");
    setUnitCostTouched(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    try {
      setError(null);
      if (isDividend) {
        if (currentQuantity <= 0) return setError("当前无持仓，无法分红");
        if (!hasDividendAmount) return setError("请填写大于 0 的分红到账总金额");
        if (!selectedCash) return setError("请选择分红入账的现金账户");
        const finalUnitCost = Number(effectiveUnitCost);
        if (effectiveUnitCost === "" || !Number.isFinite(finalUnitCost) || finalUnitCost < 0) {
          return setError("请填写有效的分红后成本价");
        }

        setPending(true);
        try {
          const res = await fetch(`/api/assets/${assetId}/dividend`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              amount: dividendNum,
              unit_cost: unitCostTouched ? finalUnitCost : null,
              cash_asset_id: selectedCash.id
            })
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            return setError(j.error ?? "分红入账失败");
          }
          setDividendAmount("");
          setUnitCost("");
          setUnitCostTouched(false);
          setCashAssetId("");
          router.refresh();
        } catch {
          setError("分红入账失败，请稍后重试");
        } finally {
          setPending(false);
        }
        return;
      }
      if (!hasPrice) return setError("请填写成交价");

      if (isClose) {
        if (currentQuantity <= 0) return setError("当前无持仓，无法清仓");
        if (
          !await confirmAction(
            `确认清仓「${assetName}」？将卖出全部 ${currentQuantity} 股${
              selectedCash ? `，回款 ${round(currentQuantity * priceNum, 2)} ${currency} 转入「${selectedCash.name}」` : ""
            }，并从资产中删除该证券。`
          )
        )
          return;

        setPending(true);
        const res = await fetch(`/api/assets/${assetId}/liquidate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: priceNum,
            cash_asset_id: cashAssetId === "" ? null : Number(cashAssetId)
          })
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? "清仓失败");
          setPending(false);
          return;
        }
        // 资产已删除，编辑页不再存在，跳回持仓列表
        router.push("/securities?view=closed");
        return;
      }

      if (!hasQty) return setError("请填写成交股数");
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
    } catch {
      setError("操作失败，请检查连接后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">证券操作（增持 / 减持 / 分红）</div>
        <span className="chip tabular">
          当前 {currentQuantity} 股 · 均价 {currentUnitCost != null ? round(currentUnitCost, 4) : "—"} {currency}
        </span>
      </div>
      <div className="card-body space-y-5">
      <form onSubmit={submit} className="space-y-4">
        {/* 方向切换 */}
        <div className="inline-flex rounded-md border border-hair p-0.5">
          <button
            type="button"
            onClick={() => selectSide("buy")}
            className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[14px] font-medium transition ${
              side === "buy" ? "bg-gain-50 text-gain-700" : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" /> 增持（买入）
          </button>
          <button
            type="button"
            onClick={() => selectSide("sell")}
            className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[14px] font-medium transition ${
              side === "sell" ? "bg-loss-50 text-loss-700" : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <TrendingDown className="h-3.5 w-3.5" /> 减持（卖出）
          </button>
          <button
            type="button"
            onClick={() => selectSide("close")}
            className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[14px] font-medium transition ${
              side === "close" ? "bg-loss-50 text-loss-700" : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <LogOut className="h-3.5 w-3.5" /> 清仓（全部卖出）
          </button>
          <button
            type="button"
            onClick={() => selectSide("dividend")}
            className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[14px] font-medium transition ${
              isDividend ? "bg-gold-50 text-gold-700" : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <Coins className="h-3.5 w-3.5" /> 分红
          </button>
        </div>

        {isDividend ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label={`分红到账总金额（${currency}）`} required hint="填写本次实际到账的总额，非每股分红">
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                className="input tabular"
                value={dividendAmount}
                onChange={(e) => setDividendAmount(e.target.value)}
              />
            </Field>
            <Field label={`现成本价（${currency} / 股）`}>
              <input className="input tabular" value={currentUnitCost ?? "—"} disabled />
            </Field>
            <Field
              label={`分红后成本价（${currency} / 股）`}
              required
              hint="按现成本价 − 到账总金额 ÷ 当前股数建议，可手动调整；最低为 0"
            >
              <input
                type="number"
                min="0"
                step="any"
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
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {isClose ? (
            <Field label="清仓股数">
              <input
                className="input tabular"
                value={`${currentQuantity}（全部）`}
                disabled
              />
            </Field>
          ) : (
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
          )}
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
          {!isClose && (
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
          )}
          </div>
        )}

        {/* 分红必须选择现金账户，交易可不调整现金 */}
        <Field
          label={
            isDividend
              ? "分红入账现金账户"
              : side === "buy"
                ? "扣款现金账户（可选）"
                : "入账现金账户（可选）"
          }
          hint={
            isDividend
              ? `仅展示 ${currency} 现金资产；分红到账必须选择一个账户`
              : isClose
                ? `清仓回款转入该 ${currency} 现金资产；不选则不记录现金`
                : `仅展示 ${currency} 现金资产；不选则不调整现金`
          }
          required={isDividend}
        >
          <select
            className="input"
            value={cashAssetId}
            onChange={(e) => setCashAssetId(e.target.value)}
          >
            <option value="">{isDividend ? "请选择现金账户" : "不调整现金"}</option>
            {cashAssets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（余额 {round(c.amount, 2)} {c.currency}）
              </option>
            ))}
          </select>
        </Field>

        {/* 预览 */}
        <div className="rounded-md border border-hair bg-canvas-inset px-3.5 py-3 text-[13px] tabular">
          <div className="grid grid-cols-2 gap-y-1.5 sm:grid-cols-4">
            <Preview
              label={isDividend ? "分红到账" : isClose ? "回款金额" : "成交额"}
              value={tradeValue != null ? formatMoney(tradeValue, currency, 2) : "—"}
            />
            <Preview
              label={isDividend ? "当前股数" : "成交后股数"}
              value={
                isDividend
                  ? round(currentQuantity, 6)
                  : isClose
                    ? "0（已清仓）"
                    : nextQuantity != null
                      ? round(nextQuantity, 6)
                      : "—"
              }
              danger={sellExceeds}
            />
            <Preview
              label={side === "buy" ? "现金扣减后" : "现金入账后"}
              value={
                selectedCash
                  ? nextCashBalance != null
                    ? formatMoney(nextCashBalance, currency, 2)
                    : formatMoney(selectedCash.amount, currency, 2)
                  : isDividend
                    ? "待选账户"
                    : "不调整"
              }
              danger={cashInsufficient}
            />
            <Preview
              label={isDividend ? "分红后成本价" : "本次方向"}
              value={
                isDividend
                  ? effectiveUnitCost !== ""
                    ? `${effectiveUnitCost} ${currency} / 股`
                    : "—"
                  : side === "buy"
                    ? "增持"
                    : side === "sell"
                      ? "减持"
                      : "清仓"
              }
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-gain-100 bg-gain-50 px-3.5 py-2.5 text-[14px] text-gain-700"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            className={side === "buy" || isDividend ? "btn-primary" : "btn-danger"}
            disabled={pending || sellExceeds || cashInsufficient || ((isClose || isDividend) && currentQuantity <= 0)}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认{side === "buy" ? "增持" : side === "sell" ? "减持" : isDividend ? "分红入账" : "清仓"}
            「{assetName}」
          </button>
        </div>
      </form>

      {undoTarget && <UndoSecurityTrade assetId={assetId} name={assetName} target={undoTarget} disabled={pending} />}
      <TradeHistory trades={trades} currency={currency} />
      </div>
    </div>
  );
}

const TRADE_LABEL: Record<SecurityTradeKind, string> = {
  buy: "增持",
  sell: "减持",
  dividend: "分红",
  liquidation: "清仓",
  opening: "建仓"
};

function TradeHistory({ trades, currency }: { trades: SecurityTradeEntry[]; currency: string }) {
  return (
    <div className="border-t border-hair pt-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="text-[13px] font-medium text-ink-700">交易明细</div>
        <span className="text-[12px] text-ink-400">{trades.length} 条</span>
      </div>
      {trades.length === 0 ? (
        <div className="rounded-md bg-canvas-sunk/60 px-3 py-5 text-center text-[13px] text-ink-400">
          暂无增持、减持、分红或清仓记录
        </div>
      ) : (
        <ul className="divide-y divide-hair rounded-md border border-hair px-3.5">
          {trades.map((trade) => {
            const inbound = trade.kind === "sell" || trade.kind === "dividend" || trade.kind === "liquidation";
            const tone = trade.kind === "dividend" ? "gold" : inbound ? "loss" : "gain";
            return (
              <li key={trade.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]">
                <span className={tone === "gold" ? "chip chip-gold" : tone === "loss" ? "chip chip-loss" : "chip chip-gain"}>
                  {TRADE_LABEL[trade.kind]}
                </span>
                <span className="min-w-0 flex-1 text-ink-700">{tradeSummary(trade)}</span>
                <span className={`tabular font-medium ${tone === "gold" ? "text-gold-700" : tone === "loss" ? "text-loss-700" : "text-gain-700"}`}>
                  {trade.grossAmount == null
                    ? "—"
                    : `${inbound ? "+" : "−"}${formatMoney(Math.abs(trade.grossAmount), currency, 2)}`}
                </span>
                <span className="tabular basis-full text-right text-[12px] text-ink-400 sm:basis-auto">
                  {formatCnDateTime(trade.occurredAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function tradeSummary(trade: SecurityTradeEntry) {
  const parts: string[] = [];
  if (trade.kind !== "dividend" && trade.quantity != null) {
    parts.push(
      trade.unitPrice != null
        ? `${formatCount(trade.quantity)} 股 × ${formatCount(trade.unitPrice)}`
        : `${formatCount(trade.quantity)} 股`
    );
  }
  if ((trade.kind === "dividend" || trade.kind === "opening") && trade.unitCostAfter != null) {
    parts.push(`成本价 ${formatCount(trade.unitCostAfter)}`);
  }
  if (trade.cashName) {
    parts.push(`${trade.kind === "buy" || trade.kind === "opening" ? "扣款" : "入账"}「${trade.cashName}」`);
  } else if (trade.kind !== "dividend") {
    parts.push("未关联现金");
  }
  return parts.join(" · ") || "—";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
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
  const id = useId();
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(children) ? children : null;
  const controlId = control?.props.id ?? id;
  return (
    <div>
      <label className="label" htmlFor={controlId}>
        {label}
        {required && <span className="ml-1 text-gain-700">*</span>}
      </label>
      {control ? cloneElement(control, { id: controlId, "aria-describedby": hint ? `${id}-hint` : control.props["aria-describedby"] }) : children}
      {hint && <p id={`${id}-hint`} className="mt-1 text-[12px] text-ink-400">{hint}</p>}
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
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-0.5 font-medium ${danger ? "text-loss-700" : "text-ink-900"}`}>{value}</div>
    </div>
  );
}
