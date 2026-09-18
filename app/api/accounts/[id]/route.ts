import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type Account, type AssetRow } from "@/lib/db";
import { portfolioTransaction, recordAssetRemoval } from "@/lib/portfolioMutations";
import { logAssetChange } from "@/lib/history";
import { recordPortfolioEvent } from "@/lib/portfolioEvents";
import { computeAssetValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  institution: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  category_id: z.number().int().positive().optional()
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    const db = getDB();
    const exists = db.prepare("SELECT * FROM account WHERE id = ?").get(id) as Account | undefined;
    if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
    const keys = Object.keys(parsed) as (keyof typeof parsed)[];
    if (keys.length === 0) return NextResponse.json({ ok: true });
    const sets = keys.map((k) => `${k} = @${k}`).join(", ");
    const account = portfolioTransaction(() => {
      const beforeCategory = db.prepare("SELECT code FROM category WHERE id = ?")
        .get(exists.category_id) as { code: string };
      db.prepare(`UPDATE account SET ${sets} WHERE id = @id`).run({ ...parsed, id });
      const afterCategory = db.prepare("SELECT code FROM category WHERE id = ?")
        .get(parsed.category_id ?? exists.category_id) as { code: string };
      const categoryChanged = beforeCategory.code !== afterCategory.code;
      const nameChanged = parsed.name != null && parsed.name !== exists.name;
      if (categoryChanged || nameChanged) {
        const assets = db.prepare("SELECT * FROM asset WHERE account_id = ?").all(id) as AssetRow[];
        for (const asset of assets) {
          const changes = {
            ...(categoryChanged ? { category_code: { from: beforeCategory.code, to: afterCategory.code } } : {}),
            ...(nameChanged ? { account_name: { from: exists.name, to: parsed.name } } : {})
          };
          logAssetChange({ action: "update", before: asset, after: asset, extraChanges: changes });
          recordPortfolioEvent({
            type: "manual_adjustment", currency: asset.currency, reason: "修改资产所属账户",
            metadata: {
              classification: "record_adjustment", changes,
              native_value_before: computeAssetValue(asset), native_value_after: computeAssetValue(asset),
              category_before: beforeCategory.code, category_after: afterCategory.code,
              currency_before: asset.currency, currency_after: asset.currency
            },
            legs: [{ assetId: asset.id, accountId: id, assetName: asset.name,
              role: afterCategory.code === "cash" ? "cash" : afterCategory.code === "securities" ? "security" : "asset",
              amountAfter: asset.amount, quantityAfter: asset.quantity }]
          });
        }
      }
      return db.prepare("SELECT * FROM account WHERE id = ?").get(id);
    })();
    return NextResponse.json({ account });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const db = getDB();
    const account = db.prepare(`SELECT c.code FROM account acc JOIN category c ON c.id = acc.category_id
      WHERE acc.id = ?`).get(id) as { code: string } | undefined;
    if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });
    portfolioTransaction(() => {
      const assets = db.prepare("SELECT * FROM asset WHERE account_id = ?").all(id) as AssetRow[];
      for (const asset of assets) recordAssetRemoval(asset, account.code, "删除所属账户");
      db.prepare("DELETE FROM account WHERE id = ?").run(id);
    })();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
