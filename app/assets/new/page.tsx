import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDB, type Account, type Category } from "@/lib/db";
import { AssetForm } from "../_components/AssetForm";

export const dynamic = "force-dynamic";

export default async function NewAssetPage() {
  const db = getDB();
  const categories = db.prepare("SELECT * FROM category ORDER BY sort_order").all() as Category[];
  const accounts = db.prepare("SELECT * FROM account ORDER BY category_id, name").all() as Account[];
  return (
    <div className="space-y-5">
      <div>
        <Link href="/assets" className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-800">
          <ArrowLeft className="h-3 w-3" /> 返回持仓
        </Link>
        <div className="mt-2">
          <div className="eyebrow">新增持仓</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900">新增资产</h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            系统会根据账户所属大类动态展示相关字段
          </p>
        </div>
      </div>
      <AssetForm mode="create" initial={null} categories={categories} accounts={accounts} />
    </div>
  );
}
