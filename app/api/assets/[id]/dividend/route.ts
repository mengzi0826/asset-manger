import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type AssetRow, getSetting } from "@/lib/db";
import { logAssetChange, ensureTodaySnapshot } from "@/lib/history";
import { recordPortfolioEvent } from "@/lib/portfolioEvents";
import { nowCn } from "@/lib/time";

export const dynamic = "force-dynamic";

const dividendSchema = z.object({
  amount: z
    .union([z.number(), z.string()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0, "分红到账总金额必须大于 0"),
  unit_cost: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => (v == null || v === "" ? null : Number(v)))
    .refine((v) => v == null || (Number.isFinite(v) && v >= 0), "新成本价无效")
    .nullable()
    .optional(),
  cash_asset_id: z
    .union([z.number(), z.string()])
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v > 0, "请选择入账现金账户")
});

interface AssetWithCode extends AssetRow {
  category_code: string;
}

function getAssetWithCode(id: number): AssetWithCode | undefined {
  return getDB()
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
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const security = getAssetWithCode(id);
    if (!security) return NextResponse.json({ error: "证券不存在" }, { status: 404 });
    if (security.category_code !== "securities") {
      return NextResponse.json({ error: "该资产不是证券，无法分红" }, { status: 400 });
    }

    const parsed = dividendSchema.parse(await req.json());
    const qty = security.quantity ?? 0;
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: "当前无持仓，无法分红" }, { status: 400 });
    }

    const cash = getAssetWithCode(parsed.cash_asset_id);
    if (!cash) return NextResponse.json({ error: "现金账户不存在" }, { status: 404 });
    if (cash.category_code !== "cash") {
      return NextResponse.json({ error: "所选账户不是现金资产" }, { status: 400 });
    }
    if (cash.currency.toUpperCase() !== security.currency.toUpperCase()) {
      return NextResponse.json({ error: "现金账户币种与证券币种不一致" }, { status: 400 });
    }

    if (parsed.unit_cost == null && security.unit_cost == null) {
      return NextResponse.json({ error: "当前成本价为空，请填写分红后的新成本价" }, { status: 400 });
    }

    const nextUnitCost =
      parsed.unit_cost ??
      Math.round(Math.max(0, security.unit_cost! - parsed.amount / qty) * 1_000_000) / 1_000_000;
    const now = nowCn();
    const db = getDB();
    const run = db.transaction(() => {
      const securityBefore = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow;
      db.prepare("UPDATE asset SET unit_cost = ?, updated_at = ? WHERE id = ?").run(nextUnitCost, now, id);
      const securityAfter = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow;
      logAssetChange({
        action: "update",
        before: securityBefore,
        after: securityAfter,
        extraChanges: { dividend_amount: { from: 0, to: parsed.amount } }
      });

      const cashBefore = db.prepare("SELECT * FROM asset WHERE id = ?").get(cash.id) as AssetRow;
      db.prepare("UPDATE asset SET amount = ?, updated_at = ? WHERE id = ?").run(
        (cashBefore.amount ?? 0) + parsed.amount,
        now,
        cash.id
      );
      const cashAfter = db.prepare("SELECT * FROM asset WHERE id = ?").get(cash.id) as AssetRow;
      logAssetChange({ action: "update", before: cashBefore, after: cashAfter });

      recordPortfolioEvent({
        type: "security_dividend",
        currency: securityAfter.currency,
        grossAmount: parsed.amount,
        occurredAt: now,
        metadata: {
          unit_cost_before: securityBefore.unit_cost,
          unit_cost_after: securityAfter.unit_cost
        },
        legs: [
          {
            assetId: securityAfter.id,
            accountId: securityAfter.account_id,
            assetName: securityAfter.name,
            role: "security",
            quantityAfter: securityAfter.quantity,
            unitCostAfter: securityAfter.unit_cost
          },
          {
            assetId: cashAfter.id,
            accountId: cashAfter.account_id,
            assetName: cashAfter.name,
            role: "cash",
            amountDelta: parsed.amount,
            amountAfter: cashAfter.amount
          }
        ]
      });

      return { asset: securityAfter, cash: cashAfter };
    });

    const result = run();
    ensureTodaySnapshot(getSetting("base_currency") ?? "CNY");
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
