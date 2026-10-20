import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getDB, getSetting, type Account, type Category, type CategoryCode } from "@/lib/db";
import { newAssetHref } from "@/lib/assetsNav";
import { valueAll } from "@/lib/valuation";
import { kickoffRatesRefresh } from "@/lib/fx";
import { kickoffStockPricesRefresh } from "@/lib/stocks";
import { accrueTodayInterest } from "@/lib/interest";
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
  accrueTodayInterest();
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
      <PageHeader title="资产" description={<>共 {items.length} 笔资产 · {accounts.length} 个账户 · 以 {baseCurrency} 结算</>} actions={<Link href={newAssetHref(activeCat) + (activeCat === "all" ? "?cat=all" : "")} className="btn-primary"><Plus className="h-4 w-4" />新增资产</Link>} />

      <AccountManager categories={categories} accounts={accounts} />

      <div className="card">
        <CategoryTabs active={activeCat} tabs={tabs} currency={baseCurrency} />
        {accounts.length === 0 ? (
          <div className="py-14 text-center text-[14px] text-ink-400">
            先在上方创建账户后再添加资产。
          </div>
        ) : (
          <AssetsTable
            key={activeCat}
            items={filtered}
            baseCurrency={baseCurrency}
            totalAssets={totalAssets}
            totalLiabilities={totalLiabilities}
            returnCat={activeCat}
          />
        )}
      </div>
    </div>
  );
}
