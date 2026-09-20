"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { ValuedAsset } from "@/lib/valuation";
import type { CategoryCode } from "@/lib/db";
import { formatDate, formatMoney, formatPercent } from "@/lib/utils";
import Link from "next/link";
import { editAssetHref } from "@/lib/assetsNav";
import { AssetRowActions } from "./AssetRowActions";

function categoryColor(code: CategoryCode): string {
  const keys: Record<CategoryCode, string> = {
    cash: "var(--cat-cash)",
    deposit: "var(--cat-deposit)",
    fund: "var(--cat-fund)",
    securities: "var(--cat-securities)",
    crypto: "var(--cat-crypto)",
    liability: "var(--cat-liability)",
    other: "var(--cat-other)"
  };
  return keys[code] ?? "var(--cat-other)";
}

interface AccountKey {
  id: number;
  name: string;
  category: string;
}

export function AssetsTable({
  items,
  baseCurrency,
  totalAssets,
  totalLiabilities,
  returnCat = "all"
}: {
  items: ValuedAsset[];
  baseCurrency: string;
  /** 全局总资产（不含负债），作为非负债行的占比分母 */
  totalAssets: number;
  /** 全局总负债（正数），作为负债行的占比分母 */
  totalLiabilities: number;
  /** 当前资产列表分类 tab，用于编辑后返回 */
  returnCat?: string;
}) {
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("default");
  const [restored, setRestored] = useState(false);
  const storageKey = `asset-manager:filters:${returnCat}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved) {
        if (Array.isArray(saved.currencies)) setSelectedCurrencies(saved.currencies.filter((v: unknown) => typeof v === "string"));
        if (Array.isArray(saved.accounts)) setSelectedAccountIds(saved.accounts.filter((v: unknown) => typeof v === "number"));
        if (typeof saved.query === "string") setQuery(saved.query);
        if (["default", "value", "name"].includes(saved.sort)) setSort(saved.sort);
      }
    } catch { /* Browser storage is optional. */ }
    setRestored(true);
  }, [storageKey]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ currencies: selectedCurrencies, accounts: selectedAccountIds, query, sort })); } catch {}
  }, [restored, storageKey, selectedCurrencies, selectedAccountIds, query, sort]);
  useEffect(() => {
    if (!restored) return;
    let frame = 0;
    try {
      const y = sessionStorage.getItem(`${storageKey}:scroll`);
      if (y != null) {
        sessionStorage.removeItem(`${storageKey}:scroll`);
        frame = requestAnimationFrame(() => window.scrollTo(0, Number(y) || 0));
      }
    } catch {}
    return () => cancelAnimationFrame(frame);
  }, [restored, storageKey]);

  const currencies = useMemo(
    () => Array.from(new Set(items.map((a) => a.currency))).sort(),
    [items]
  );

  const accounts: AccountKey[] = useMemo(() => {
    const map = new Map<number, AccountKey>();
    for (const a of items) {
      if (!map.has(a.account_id)) {
        map.set(a.account_id, {
          id: a.account_id,
          name: a.account_name,
          category: a.category_name
        });
      }
    }
    return Array.from(map.values()).sort((x, y) =>
      x.name.localeCompare(y.name, "zh")
    );
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const result = items.filter((a) => {
      if (needle && ![a.name, a.symbol, a.account_name].some((value) => value?.toLocaleLowerCase().includes(needle))) return false;
      if (
        selectedCurrencies.length > 0 &&
        !selectedCurrencies.includes(a.currency)
      )
        return false;
      if (
        selectedAccountIds.length > 0 &&
        !selectedAccountIds.includes(a.account_id)
      )
        return false;
      return true;
    });
    if (sort === "value") result.sort((a, b) => b.base_value - a.base_value);
    if (sort === "name") result.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    return result;
  }, [items, selectedCurrencies, selectedAccountIds, query, sort]);

  const filteredAssetTotal = filtered
    .filter((a) => a.category_code !== "liability")
    .reduce((s, a) => s + a.base_value, 0);
  const filteredLiabTotal = filtered
    .filter((a) => a.category_code === "liability")
    .reduce((s, a) => s + a.base_value, 0);
  const filteredTotal = filteredAssetTotal - filteredLiabTotal;
  const hasFilter =
    selectedCurrencies.length > 0 || selectedAccountIds.length > 0 || query.trim().length > 0;

  function toggleCurrency(c: string) {
    setSelectedCurrencies((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }
  function toggleAccount(id: number) {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function clearAll() {
    setSelectedCurrencies([]);
    setSelectedAccountIds([]);
    setQuery("");
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-6 py-4">
        <label className="relative min-w-0 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" /><input className="input pl-10" aria-label="搜索资产" placeholder="搜索资产、代码或账户" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select className="input-sm" aria-label="资产排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="default">默认排序</option><option value="value">估值从高到低</option><option value="name">按名称排序</option></select>
      </div>
      {/* 过滤条 */}
      {items.length > 0 && (currencies.length > 1 || accounts.length > 1) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair px-4 py-3">
          {currencies.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[12px] font-semibold uppercase tracking-wider text-ink-400">
                币种
              </span>
              {currencies.map((c) => {
                const active = selectedCurrencies.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCurrency(c)}
                    className={`chip tabular transition ${
                      active
                        ? "border-brand-500 bg-brand-100 text-brand-700"
                        : "hover:border-ink-400 hover:text-ink-900"
                    }`}
                    aria-pressed={active}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          )}

          {currencies.length > 1 && accounts.length > 1 && (
            <span className="h-5 w-px bg-hair" aria-hidden="true" />
          )}

          {accounts.length > 1 && (
            <details className="account-filter" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
              <summary className="btn-outline cursor-pointer list-none">账户{selectedAccountIds.length ? ` · 已选 ${selectedAccountIds.length}` : " · 全部"}<ChevronDown className="h-3.5 w-3.5" /></summary>
              <div className="account-filter-options">
                {accounts.map((a) => <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-canvas-sunk"><input type="checkbox" checked={selectedAccountIds.includes(a.id)} onChange={() => toggleAccount(a.id)} className="h-4 w-4 accent-brand-500" /><span className="min-w-0 flex-1 text-sm text-ink-700">{a.name}<small className="block text-xs text-ink-400">{a.category}</small></span></label>)}
              </div>
            </details>
          )}

          {hasFilter && (
            <button
              type="button"
              onClick={clearAll}
              className="btn-ghost ml-auto h-7 px-2 text-[12px]"
              aria-label="清除筛选"
            >
              <X className="h-3 w-3" /> 清除
            </button>
          )}
        </div>
      )}

      {/* 筛选小计 */}
      {hasFilter && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hair bg-canvas-sunk px-4 py-2 text-[13px] text-ink-500">
          <span>
            匹配{" "}
            <span className="font-medium text-ink-900 tabular">
              {filtered.length}
            </span>{" "}
            / {items.length} 笔
          </span>
          {filteredAssetTotal > 0 && (
            <span>
              资产小计{" "}
              <span className="font-medium text-ink-900 tabular">
                {formatMoney(filteredAssetTotal, baseCurrency)}
              </span>
              {totalAssets > 0 && (
                <span className="ml-1 text-ink-400">
                  · 占总资产{" "}
                  <span className="tabular">
                    {formatPercent(filteredAssetTotal / totalAssets)}
                  </span>
                </span>
              )}
            </span>
          )}
          {filteredLiabTotal > 0 && (
            <span>
              负债小计{" "}
              <span className="font-medium text-loss-700 tabular">
                -{formatMoney(filteredLiabTotal, baseCurrency)}
              </span>
              {totalLiabilities > 0 && (
                <span className="ml-1 text-ink-400">
                  · 占总负债{" "}
                  <span className="tabular">
                    {formatPercent(filteredLiabTotal / totalLiabilities)}
                  </span>
                </span>
              )}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto" onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("a")) {
          try { sessionStorage.setItem(`${storageKey}:scroll`, String(window.scrollY)); } catch {}
        }
      }}>
        {filtered.length === 0 ? (
          <div className="py-14 text-center text-[14px] text-ink-400">
            {items.length === 0 ? (
              "此分类下暂无资产。"
            ) : (
              <>
                没有符合筛选条件的资产。{" "}
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-ink-800 underline"
                >
                  清除筛选
                </button>
              </>
            )}
          </div>
        ) : (
          <table className="data-table min-w-[860px]">
            <thead>
              <tr>
                <th className="text-left">名称 / 账户</th>
                <th className="text-left">币种</th>
                <th className="text-right">原币价值</th>
                <th className="text-right">{baseCurrency} 估值</th>
                <th className="text-right">占比</th>
                <th className="text-right">盈亏</th>
                <th className="text-right">到期</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const isLiability = a.category_code === "liability";
                // B1: 负债行用「占总负债」做分母；非负债行用「占总资产」
                const denom = isLiability ? totalLiabilities : totalAssets;
                const pct = denom ? a.base_value / denom : 0;
                const gain = a.profit_rate;
                return (
                  <tr key={a.id} className="group">
                    <td className="text-left">
                      <div className="flex flex-col">
                        <span className="flex items-center gap-2">
                          <Link href={editAssetHref(a.id, returnCat) + (returnCat === "all" ? "?cat=all" : "")} className="font-medium text-ink-900 hover:text-brand-600">{a.name}</Link>
                          {a.symbol && (
                            <span className="chip tabular text-[11px] uppercase">
                              {a.symbol}
                            </span>
                          )}
                        </span>
                        <span className="text-[12px] text-ink-400">
                          <span
                            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-sm align-middle"
                            style={{ background: categoryColor(a.category_code) }}
                            aria-hidden="true"
                          />
                          {a.category_name} · {a.account_name}
                        </span>
                      </div>
                    </td>
                    <td className="text-left">
                      <span className="chip tabular">{a.currency}</span>
                    </td>
                    <td className="tabular text-right">
                      {formatMoney(a.native_value, a.currency, 2)}
                    </td>
                    <td
                      className={`tabular text-right font-medium ${
                        isLiability ? "text-loss-700" : "text-ink-900"
                      }`}
                    >
                      {isLiability ? "-" : ""}
                      {formatMoney(a.base_value, baseCurrency)}
                    </td>
                    <td className="tabular text-right text-ink-500">
                      {pct === 0 ? (
                        <span className="text-ink-300">—</span>
                      ) : (
                        <span title={isLiability ? "占总负债" : "占总资产"}>
                          {formatPercent(pct)}
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {gain == null ? (
                        a.annual_rate != null ? (
                          <span className="chip chip-gold tabular">
                            {formatPercent(a.annual_rate, 2)} 年化
                          </span>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )
                      ) : (
                        <span
                          className={`chip tabular ${
                            gain >= 0 ? "chip-gain" : "chip-loss"
                          }`}
                        >
                          {gain >= 0 ? "▲" : "▼"} {formatPercent(gain, 2)}
                        </span>
                      )}
                    </td>
                    <td className="tabular text-right text-[13px] text-ink-500">
                      {a.maturity_date ? (
                        formatDate(a.maturity_date)
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      <AssetRowActions id={a.id} returnCat={returnCat} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
