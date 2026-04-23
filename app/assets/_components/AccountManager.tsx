"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { Account, Category, CategoryCode } from "@/lib/db";

const CAT_COLORS: Record<CategoryCode, string> = {
  cash: "var(--cat-cash)",
  deposit: "var(--cat-deposit)",
  fund: "var(--cat-fund)",
  securities: "var(--cat-securities)",
  crypto: "var(--cat-crypto)",
  liability: "var(--cat-liability)",
  other: "var(--cat-other)"
};

export function AccountManager({
  categories,
  accounts
}: {
  categories: Category[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(accounts.length === 0);
  const [form, setForm] = useState({
    category_id: categories[0]?.id ?? 0,
    name: "",
    institution: "",
    notes: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "创建失败");
      return;
    }
    setForm({ ...form, name: "", institution: "", notes: "" });
    start(() => router.refresh());
  }

  async function removeAccount(id: number, name: string) {
    if (!confirm(`删除账户「${name}」会级联删除其下所有资产，确认？`)) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    start(() => router.refresh());
  }

  const byCat: Record<number, Account[]> = {};
  for (const a of accounts) (byCat[a.category_id] ??= []).push(a);

  return (
    <div className="card">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between border-b border-hair px-5 py-3 text-left transition-colors hover:bg-canvas-sunk/40"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="card-title">账户管理</span>
          <span className="chip tabular">{accounts.length} 个账户</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-ink-400" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-ink-400" aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className="card-body space-y-5">
          <form
            onSubmit={createAccount}
            className="grid grid-cols-1 gap-3 rounded-md bg-canvas-sunk/60 p-4 md:grid-cols-12"
          >
            <div className="md:col-span-3">
              <label className="label">大类</label>
              <select
                className="input"
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="label">账户名称</label>
              <input
                className="input"
                required
                placeholder="工行活期 / 雪球 / 币安 / 房贷"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <label className="label">机构</label>
              <input
                className="input"
                placeholder="ICBC / Binance"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <label className="label">备注</label>
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            {error && (
              <div
                role="alert"
                className="rounded-md border border-loss-100 bg-loss-50 px-3 py-2 text-[13px] text-loss-700 md:col-span-12"
              >
                {error}
              </div>
            )}
            <div className="md:col-span-12">
              <button className="btn-primary" disabled={pending}>
                <Plus className="h-3.5 w-3.5" /> 添加账户
              </button>
            </div>
          </form>

          {accounts.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-ink-400">
              还没有账户。请先在上面创建一个账户（小类），如「工行活期」「雪球账户」。
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {categories.map((c) => {
                const list = byCat[c.id] ?? [];
                if (list.length === 0) return null;
                return (
                  <div
                    key={c.id}
                    className="rounded-md border border-hair bg-canvas-raised p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        aria-hidden="true"
                        style={{ background: CAT_COLORS[c.code as CategoryCode] }}
                      />
                      <span className="text-[12px] font-semibold text-ink-900">
                        {c.name}
                      </span>
                      <span className="chip tabular ml-auto">{list.length}</span>
                    </div>
                    <ul className="divide-y divide-hair">
                      {list.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between py-2 text-[12.5px]"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink-800">
                              {a.name}
                            </div>
                            {(a.institution || a.notes) && (
                              <div className="truncate text-[11px] text-ink-400">
                                {a.institution}
                                {a.institution && a.notes && " · "}
                                {a.notes}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => removeAccount(a.id, a.name)}
                            aria-label="删除账户"
                            className="btn-ghost h-6 w-6 p-0 text-loss-600 hover:bg-loss-50"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
