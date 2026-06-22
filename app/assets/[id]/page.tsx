import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getDB, type Account, type AssetRow, type Category } from "@/lib/db";
import { AssetForm } from "../_components/AssetForm";
import { TradeDialog, type CashAssetOption } from "./_components/TradeDialog";

export const dynamic = "force-dynamic";

export default async function EditAssetPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const db = getDB();
  const asset = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow | undefined;
  if (!asset) notFound();
  const categories = db.prepare("SELECT * FROM category ORDER BY sort_order").all() as Category[];
  const accounts = db.prepare("SELECT * FROM account ORDER BY category_id, name").all() as Account[];

  const assetCategory = categories.find(
    (c) => c.id === accounts.find((a) => a.id === asset.account_id)?.category_id
  );
  const isSecurity = assetCategory?.code === "securities";
  const cashAssets = isSecurity
    ? (db
        .prepare(
          `SELECT a.id, a.name, COALESCE(a.amount, 0) AS amount, a.currency
           FROM asset a
           JOIN account acc ON acc.id = a.account_id
           JOIN category c ON c.id = acc.category_id
           WHERE c.code = 'cash' AND UPPER(a.currency) = UPPER(?)
           ORDER BY acc.name, a.name`
        )
        .all(asset.currency) as CashAssetOption[])
    : [];
  return (
    <div className="space-y-5">
      <div>
        <Link href="/assets" className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-800">
          <ArrowLeft className="h-3 w-3" /> 返回资产
        </Link>
        <div className="mt-2">
          <div className="eyebrow">编辑资产</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900">
            {asset.name}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            保存后会自动记录一条字段级变动日志
          </p>
        </div>
      </div>
      {isSecurity && (
        <TradeDialog
          assetId={asset.id}
          assetName={asset.name}
          currency={asset.currency}
          currentQuantity={asset.quantity ?? 0}
          currentUnitCost={asset.unit_cost}
          currentPrice={asset.current_price}
          cashAssets={cashAssets}
        />
      )}
      <AssetForm mode="edit" initial={asset} categories={categories} accounts={accounts} />
    </div>
  );
}
