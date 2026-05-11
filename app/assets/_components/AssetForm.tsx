"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowLeft, Loader2, Save, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import type { Account, AssetRow, Category, CategoryCode } from "@/lib/db";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

interface FormState {
  account_id: number;
  name: string;
  symbol: string;
  currency: string;
  quantity: string;
  unit_cost: string;
  current_price: string;
  amount: string;
  annual_rate: string;
  start_date: string;
  maturity_date: string;
  notes: string;
}

interface SecuritySuggestion {
  code: string;
  name: string;
  exchange: string;
  classify: string;
  typeName: string;
  currency: "CNY" | "USD" | "HKD";
  quote_id: string;
}

function rowToForm(row: AssetRow | null, defaultAccountId: number): FormState {
  if (!row) {
    return {
      account_id: defaultAccountId,
      name: "",
      symbol: "",
      currency: "CNY",
      quantity: "1",
      unit_cost: "",
      current_price: "",
      amount: "",
      annual_rate: "",
      start_date: "",
      maturity_date: "",
      notes: ""
    };
  }
  return {
    account_id: row.account_id,
    name: row.name,
    symbol: row.symbol ?? "",
    currency: row.currency,
    quantity: String(row.quantity ?? 1),
    unit_cost: row.unit_cost != null ? String(row.unit_cost) : "",
    current_price: row.current_price != null ? String(row.current_price) : "",
    amount: row.amount != null ? String(row.amount) : "",
    annual_rate: row.annual_rate != null ? String(row.annual_rate) : "",
    start_date: row.start_date ?? "",
    maturity_date: row.maturity_date ?? "",
    notes: row.notes ?? ""
  };
}

export function AssetForm({
  mode,
  initial,
  categories,
  accounts
}: {
  mode: "create" | "edit";
  initial: AssetRow | null;
  categories: Category[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    rowToForm(initial, accounts[0]?.id ?? 0)
  );
  /**
   * 标记 currency / symbol 是否被「证券查询」自动填充过且用户尚未手动覆盖。
   * 切换账户到非 securities 类时，这种"残留的 USD/HKD"应当被自动清掉，
   * 避免在现金类账户里默默挂着一个 USD 货币。
   */
  const [lookupAutoFilled, setLookupAutoFilled] = useState(false);

  const currentAccount = accounts.find((a) => a.id === form.account_id);
  const currentCategory = currentAccount
    ? categories.find((c) => c.id === currentAccount.category_id)
    : null;
  const code: CategoryCode = (currentCategory?.code as CategoryCode) ?? "other";

  function handleAccountChange(nextAccountId: number) {
    const nextAcc = accounts.find((a) => a.id === nextAccountId);
    const nextCat = nextAcc
      ? categories.find((c) => c.id === nextAcc.category_id)
      : null;
    const nextCode = (nextCat?.code as CategoryCode) ?? "other";
    setForm((f) => {
      let { currency, symbol } = f;
      // 切到非证券类：股票代码字段无意义，直接清掉
      if (nextCode !== "securities" && symbol) {
        symbol = "";
      }
      // 切到非证券类，且 currency 是查询自动填充而来的 → 重置为 CNY
      if (nextCode !== "securities" && lookupAutoFilled) {
        currency = "CNY";
      }
      return { ...f, account_id: nextAccountId, currency, symbol };
    });
    setLookupAutoFilled(false);
  }

  // 证券/股票按"份额 × 价格"记账；其余（现金/存款/基金/加密货币/负债/其他）直接记总金额。
  const showQuantityPrice = code === "securities";
  const showAmount = !showQuantityPrice;
  // 存款用"利率 + 起息/到期"；负债用"利率 + 到期"
  const showRateMaturity = code === "deposit" || code === "liability";
  const isLiability = code === "liability";

  const accountsByCategory = useMemo(() => {
    const map: Record<number, Account[]> = {};
    for (const a of accounts) (map[a.category_id] ??= []).push(a);
    return map;
  }, [accounts]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.account_id) {
      setError("请先创建一个账户（小类）");
      return;
    }
    const payload: Record<string, any> = {
      account_id: form.account_id,
      name: form.name.trim(),
      symbol: code === "securities" && form.symbol.trim() ? form.symbol.trim().toUpperCase() : null,
      currency: form.currency,
      quantity: form.quantity === "" ? 1 : Number(form.quantity),
      unit_cost: form.unit_cost === "" ? null : Number(form.unit_cost),
      current_price: form.current_price === "" ? null : Number(form.current_price),
      amount: form.amount === "" ? null : Number(form.amount),
      annual_rate: form.annual_rate === "" ? null : Number(form.annual_rate),
      start_date: form.start_date || null,
      maturity_date: form.maturity_date || null,
      notes: form.notes || null
    };

    const url = mode === "create" ? "/api/assets" : `/api/assets/${initial!.id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "保存失败");
      return;
    }
    start(() => router.push("/assets"));
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`确定删除「${initial.name}」？`)) return;
    await fetch(`/api/assets/${initial.id}`, { method: "DELETE" });
    start(() => router.push("/assets"));
  }

  if (accounts.length === 0) {
    return (
      <div className="card">
        <div className="card-body flex flex-col items-center gap-3 py-10 text-center text-[13px] text-ink-500">
          <AlertTriangle className="h-6 w-6 text-gold-500" />
          <div>
            <div className="text-[15px] font-semibold text-ink-900">还没有账户</div>
            <div className="mt-1">请先到「持仓」页创建一个账户（小类）后再添加资产。</div>
          </div>
          <Link href="/assets" className="btn-primary">
            前往创建账户
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Section: Classification */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">分类信息</div>
          <span className="chip">{currentCategory?.name ?? "—"}</span>
        </div>
        <div className="card-body space-y-4">
          {code === "securities" && (
            <SecurityLookup
              onPick={(item) => {
                setForm((f) => ({
                  ...f,
                  name: item.name,
                  symbol: item.code,
                  currency: item.currency
                }));
                setLookupAutoFilled(true);
              }}
            />
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="账户（小类）" required>
              <select
                className="input"
                value={form.account_id}
                onChange={(e) => handleAccountChange(Number(e.target.value))}
              >
                {categories.map((c) => {
                  const list = accountsByCategory[c.id] ?? [];
                  if (list.length === 0) return null;
                  return (
                    <optgroup key={c.id} label={c.name}>
                      {list.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </Field>
            <Field label="资产名称" required>
              <input
                className="input"
                required
                placeholder={namePlaceholder(code)}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="计价货币">
              <select
                className="input tabular"
                value={form.currency}
                onChange={(e) => {
                  setForm({ ...form, currency: e.target.value });
                  setLookupAutoFilled(false);
                }}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {code === "securities" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="股票代码" hint="示例：600519 / 00700 / AAPL；可留空">
                <input
                  className="input tabular"
                  placeholder="AAPL / 00700 / 600519"
                  value={form.symbol}
                  onChange={(e) => {
                    setForm({ ...form, symbol: e.target.value.toUpperCase() });
                    setLookupAutoFilled(false);
                  }}
                />
              </Field>
            </div>
          )}
        </div>
      </div>

      {/* Section: Position */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">持仓数据</div>
          <span className="text-[11px] text-ink-400">按大类自动展示相关字段</span>
        </div>
        <div className="card-body">
          {showAmount && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label={isLiability ? `欠款金额（${form.currency}）` : `金额（${form.currency}）`}
                required
                hint={isLiability ? "输入为正数，总览会自动从总资产里扣减" : undefined}
              >
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className="input tabular"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
            </div>
          )}
          {showQuantityPrice && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="份额 / 股数 / 数量">
                <input
                  type="number"
                  step="0.00000001"
                  inputMode="decimal"
                  className="input tabular"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </Field>
              <Field label={`买入均价（${form.currency}）`}>
                <input
                  type="number"
                  step="0.0001"
                  inputMode="decimal"
                  className="input tabular"
                  placeholder="可选，用于计算盈亏"
                  value={form.unit_cost}
                  onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                />
              </Field>
              <Field label={`当前价（${form.currency}）`}>
                <input
                  type="number"
                  step="0.0001"
                  inputMode="decimal"
                  className="input tabular"
                  placeholder="手动维护"
                  value={form.current_price}
                  onChange={(e) => setForm({ ...form, current_price: e.target.value })}
                />
              </Field>
            </div>
          )}
        </div>
      </div>

      {/* Section: Yield & Maturity（存款 / 负债） */}
      {showRateMaturity && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              {isLiability ? "贷款利率与到期" : "利率与到期"}
            </div>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="年化利率（小数，0.035 = 3.5%）">
                <input
                  type="number"
                  step="0.0001"
                  inputMode="decimal"
                  className="input tabular"
                  value={form.annual_rate}
                  onChange={(e) => setForm({ ...form, annual_rate: e.target.value })}
                />
              </Field>
              <Field label="起息日">
                <input
                  type="date"
                  className="input"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </Field>
              <Field label="到期日">
                <input
                  type="date"
                  className="input"
                  value={form.maturity_date}
                  onChange={(e) => setForm({ ...form, maturity_date: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>
      )}

      {/* Section: Notes */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">备注</div>
        </div>
        <div className="card-body">
          <textarea
            className="input min-h-[80px]"
            placeholder="备注、策略、风险提示..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
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

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-2 rounded-lg border border-hair bg-canvas-raised p-3 shadow-pop">
        <Link href="/assets" className="btn-ghost">
          <ArrowLeft className="h-3.5 w-3.5" /> 返回
        </Link>
        <div className="flex items-center gap-2">
          {mode === "edit" && (
            <button type="button" onClick={remove} className="btn-danger">
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          )}
          <button className="btn-primary" disabled={pending}>
            <Save className="h-3.5 w-3.5" /> {mode === "edit" ? "保存修改" : "创建资产"}
          </button>
        </div>
      </div>
    </form>
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

function SecurityLookup({
  onPick
}: {
  onPick: (item: SecuritySuggestion) => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SecuritySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqSeq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    const keyword = q.trim();
    if (!keyword) {
      setItems([]);
      setErr(null);
      return;
    }
    const mySeq = ++reqSeq.current;
    const ctl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/securities/search?q=${encodeURIComponent(keyword)}&limit=10`,
          { signal: ctl.signal }
        );
        const j = (await res.json()) as { items: SecuritySuggestion[]; error?: string };
        if (reqSeq.current !== mySeq) return;
        setItems(j.items || []);
        setErr(j.error ?? null);
        setOpen(true);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (reqSeq.current !== mySeq) return;
        setErr(e?.message ?? "搜索失败");
      } finally {
        if (reqSeq.current === mySeq) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  return (
    <div ref={boxRef} className="relative">
      <label className="label">按名称 / 代码搜索股票</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
        </span>
        <input
          className="input pl-8"
          placeholder="输入股票名 / 代码，如 腾讯、AAPL、600519"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length > 0 && setOpen(true)}
        />
      </div>
      {open && (items.length > 0 || err) && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-hair bg-canvas-raised shadow-pop">
          {err && items.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-ink-400">
              搜索失败：{err}，请稍后重试或直接手动输入代码
            </div>
          )}
          {items.map((it) => (
            <button
              type="button"
              key={`${it.code}-${it.quote_id}`}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-canvas-inset focus:bg-canvas-inset focus:outline-none"
              onClick={() => {
                onPick(it);
                setOpen(false);
                setQ("");
                setItems([]);
              }}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium text-ink-900">
                  {it.name}
                </span>
                <span className="mt-0.5 truncate text-[11px] text-ink-400">
                  {it.typeName || it.exchange}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular text-[12px] text-ink-700">{it.code}</span>
                <span className="chip tabular">{it.currency}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-ink-400">
        选中后会自动填写 资产名称 / 股票代码 / 计价货币；数据来源：东方财富
      </p>
    </div>
  );
}

function namePlaceholder(code: CategoryCode) {
  switch (code) {
    case "cash":
      return "工行活期 / 支付宝余额";
    case "deposit":
      return "三年定期 A / 结构性存款";
    case "fund":
      return "沪深 300 ETF";
    case "securities":
      return "茅台 600519 / Apple";
    case "crypto":
      return "BTC / ETH / USDT";
    case "liability":
      return "房贷 / 车贷 / 信用卡分期";
    default:
      return "资产名称";
  }
}
