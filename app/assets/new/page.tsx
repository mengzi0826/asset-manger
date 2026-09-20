import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDB, type Account, type Category } from "@/lib/db";
import { assetsListHref } from "@/lib/assetsNav";
import { AssetForm, type CashAssetOption } from "../_components/AssetForm";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { cat?: string };
}

function resolveDefaultAccountId(
  accounts: Account[],
  categories: Category[],
  cat?: string
): number {
  if (cat) {
    const category = categories.find((c) => c.code === cat);
    if (category) {
      const match = accounts.find((a) => a.category_id === category.id);
      if (match) return match.id;
    }
  }
  return accounts[0]?.id ?? 0;
}

export default async function NewAssetPage({ searchParams }: PageProps) {
  const db = getDB();
  const categories = db.prepare("SELECT * FROM category ORDER BY sort_order").all() as Category[];
  const accounts = db.prepare("SELECT * FROM account ORDER BY category_id, name").all() as Account[];
  const defaultAccountId = resolveDefaultAccountId(accounts, categories, searchParams?.cat);
  const returnCat = searchParams?.cat;
  const listHref = assetsListHref(returnCat);
  const cashAssets = db
    .prepare(
      `SELECT a.id, a.name, COALESCE(a.amount, 0) AS amount, a.currency
       FROM asset a
       JOIN account acc ON acc.id = a.account_id
       JOIN category c ON c.id = acc.category_id
       WHERE c.code = 'cash'
       ORDER BY acc.name, a.name`
    )
    .all() as CashAssetOption[];
  return (
    <div className="space-y-5">
      <div>
        <Link href={listHref} className="inline-flex items-center gap-1 text-[13px] text-ink-400 hover:text-ink-800">
          <ArrowLeft className="h-3 w-3" /> 返回资产
        </Link>
        <div className="mt-4"><PageHeader title="新增资产" /></div>
      </div>
      <AssetForm
        mode="create"
        initial={null}
        categories={categories}
        accounts={accounts}
        cashAssets={cashAssets}
        defaultAccountId={defaultAccountId}
        returnCat={returnCat}
      />
    </div>
  );
}
