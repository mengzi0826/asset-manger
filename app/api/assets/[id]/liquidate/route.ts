import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type AssetRow, getSetting } from "@/lib/db";
import { logAssetChange, ensureTodaySnapshot } from "@/lib/history";
import { nowCn } from "@/lib/time";

export const dynamic = "force-dynamic";

const liquidateSchema = z.object({
  price: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, "成交价无效"),
  cash_asset_id: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => (v == null || v === "" ? null : Number(v)))
    .refine((v) => v == null || (Number.isInteger(v) && v > 0), "现金账户无效")
    .nullable()
    .optional()
});

interface AssetWithCode extends AssetRow {
  category_code: string;
}

function getAssetWithCode(id: number): AssetWithCode | undefined {
  const db = getDB();
  return db
    .prepare(
      `SELECT a.*, c.code AS category_code
       FROM asset a
       JOIN account acc ON acc.id = a.account_id
       JOIN category c ON c.id = acc.category_id
       WHERE a.id = ?`
    )
    .get(id) as AssetWithCode | undefined;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const db = getDB();
    const security = getAssetWithCode(id);
    if (!security) return NextResponse.json({ error: "证券不存在" }, { status: 404 });
    if (security.category_code !== "securities") {
      return NextResponse.json({ error: "该资产不是证券，无法清仓" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = liquidateSchema.parse(body);

    const qty = security.quantity ?? 0;
    const proceeds = qty * parsed.price;

    let cash: AssetWithCode | undefined;
    if (parsed.cash_asset_id != null) {
      cash = getAssetWithCode(parsed.cash_asset_id);
      if (!cash) return NextResponse.json({ error: "现金账户不存在" }, { status: 404 });
      if (cash.category_code !== "cash") {
        return NextResponse.json({ error: "所选账户不是现金资产" }, { status: 400 });
      }
      if (cash.currency.toUpperCase() !== security.currency.toUpperCase()) {
        return NextResponse.json(
          { error: "现金账户币种与证券币种不一致" },
          { status: 400 }
        );
      }
    }

    const now = nowCn();
    const run = db.transaction(() => {
      if (cash) {
        const cashBefore = db.prepare("SELECT * FROM asset WHERE id = ?").get(cash.id) as AssetRow;
        const nextAmount = (cashBefore.amount ?? 0) + proceeds;
        db.prepare(
          `UPDATE asset SET amount = @amount, updated_at = @updated_at WHERE id = @id`
        ).run({ id: cash.id, amount: nextAmount, updated_at: now });
        const cashAfter = db.prepare("SELECT * FROM asset WHERE id = ?").get(cash.id) as AssetRow;
        logAssetChange({ action: "update", before: cashBefore, after: cashAfter });
      }

      const securityBefore = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow;
      db.prepare("DELETE FROM asset WHERE id = ?").run(id);
      logAssetChange({ action: "delete", before: securityBefore });
    });

    run();
    ensureTodaySnapshot(getSetting("base_currency") ?? "CNY");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
