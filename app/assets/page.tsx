import Link from "next/link";
import { Plus } from "lucide-react";
import { getDB, getSetting, type Account, type Category, type CategoryCode } from "@/lib/db";
import { valueAll } from "@/lib/valuation";
import { kickoffRatesRefresh } from "@/lib/fx";
import { kickoffStockPricesRefresh } from "@/lib/stocks";
import { AccountManager } from "./_components/AccountManager";
import { CategoryTabs } from "./_components/CategoryTabs";
import { AssetsTable } from "./_components/AssetsTable";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { cat?: string };
}

export default async function AssetsPage({ searchParams }: PageProps) {
  kickoffRatesRefresh();
  kickoffStockPricesRefresh();
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const db = getDB();
  const categories = db
    .prepare("SELECT * FROM category ORDER BY sort_order")
    .all() as Category[];
  const accounts = db
    .prepare("SELECT * FROM account ORDER BY name")
    .all() as Account[];
  const { items, total, totalAssets, totalLiabilities, byCategory } =
    valueAll(baseCurrency);

  const activeCat = (searchParams?.cat ?? "all") as string;
  const filtered =
    activeCat === "all" ? items : items.filter((a) => a.category_code === activeCat);

  const tabs = [
    {
      key: "all",
      label: "全部",
      count: items.length,
      total
    },
    ...categories.map((c) => ({
      key: c.code,
      label: c.name,
      count: items.filter((i) => i.category_code === c.code).length,
      total: byCategory[c.code as CategoryCode] ?? 0
    }))
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">持仓管理</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900">
            持仓
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            共 {items.length} 笔资产 · {accounts.length} 个账户 · 以 {baseCurrency} 结算
          </p>
        </div>
        <Link href="/assets/new" className="btn-primary">
          <Plus className="h-3.5 w-3.5" /> 新增资产
        </Link>
      </div>

      <AccountManager categories={categories} accounts={accounts} />

      <div className="card">
        <CategoryTabs active={activeCat} tabs={tabs} currency={baseCurrency} />
        {accounts.length === 0 ? (
          <div className="py-14 text-center text-[13px] text-ink-400">
            先在上方创建账户后再添加资产。
          </div>
        ) : (
          <AssetsTable
            items={filtered}
            baseCurrency={baseCurrency}
            totalAssets={totalAssets}
            totalLiabilities={totalLiabilities}
          />
        )}
      </div>
    </div>
  );
}
