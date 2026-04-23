"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ValuedAsset } from "@/lib/valuation";
import type { CategoryCode } from "@/lib/db";
import { formatDate, formatMoney, formatPercent } from "@/lib/utils";
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
  total
}: {
  items: ValuedAsset[];
  baseCurrency: string;
  total: number;
}) {
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);

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
    return items.filter((a) => {
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
  }, [items, selectedCurrencies, selectedAccountIds]);

  const filteredTotal = filtered.reduce((s, a) => s + a.base_value, 0);
  const hasFilter =
    selectedCurrencies.length > 0 || selectedAccountIds.length > 0;

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
  }

  return (
    <>
      {/* 过滤条 */}
      {items.length > 0 && (currencies.length > 1 || accounts.length > 1) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair px-4 py-3">
          {currencies.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
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
                        ? "border-gold-500 bg-gold-100 text-gold-700"
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
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                账户
              </span>
              {accounts.map((a) => {
                const active = selectedAccountIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAccount(a.id)}
                    title={a.category}
                    className={`chip transition ${
                      active
                        ? "border-gold-500 bg-gold-100 text-gold-700"
                        : "hover:border-ink-400 hover:text-ink-900"
                    }`}
                    aria-pressed={active}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}

          {hasFilter && (
            <button
              type="button"
              onClick={clearAll}
              className="btn-ghost ml-auto h-7 px-2 text-[11px]"
              aria-label="清除筛选"
            >
              <X className="h-3 w-3" /> 清除
            </button>
          )}
        </div>
      )}

      {/* 筛选小计 */}
      {hasFilter && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hair bg-canvas-sunk px-4 py-2 text-[12px] text-ink-500">
          <span>
            匹配{" "}
            <span className="font-medium text-ink-900 tabular">
              {filtered.length}
            </span>{" "}
            / {items.length} 笔
          </span>
          <span>
            小计估值{" "}
            <span className="font-medium text-ink-900 tabular">
              {formatMoney(filteredTotal, baseCurrency)}
            </span>
          </span>
          <span>
            占当前分类{" "}
            <span className="font-medium text-ink-900 tabular">
              {formatPercent(total ? filteredTotal / total : 0)}
            </span>
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-14 text-center text-[13px] text-ink-400">
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
          <table className="data-table">
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
                const pct = total ? a.base_value / total : 0;
                const gain = a.profit_rate;
                return (
                  <tr key={a.id} className="group">
                    <td className="text-left">
                      <div className="flex flex-col">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-ink-900">{a.name}</span>
                          {a.symbol && (
                            <span className="chip tabular text-[10px] uppercase">
                              {a.symbol}
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-ink-400">
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
                    <td className="tabular text-right font-medium text-ink-900">
                      {formatMoney(a.base_value, baseCurrency)}
                    </td>
                    <td className="tabular text-right text-ink-500">
                      {formatPercent(pct)}
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
                    <td className="tabular text-right text-[12px] text-ink-500">
                      {a.maturity_date ? (
                        formatDate(a.maturity_date)
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      <AssetRowActions id={a.id} />
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
