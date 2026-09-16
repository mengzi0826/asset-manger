import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type AssetRow, getSetting } from "@/lib/db";
import { ensureTodaySnapshot, logAssetChange } from "@/lib/history";
import { recordPortfolioEvent } from "@/lib/portfolioEvents";
import { nowCn } from "@/lib/time";

export const dynamic = "force-dynamic";

const cashFlowSchema = z.object({
  type: z.enum(["deposit", "expense"]),
  amount: z
    .union([z.number(), z.string()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0, "金额必须大于 0"),
  reason: z.string().trim().min(1, "请填写变动原因").max(200, "变动原因不能超过 200 字")
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

    const cash = getAssetWithCode(id);
    if (!cash) return NextResponse.json({ error: "现金资产不存在" }, { status: 404 });
    if (cash.category_code !== "cash") {
      return NextResponse.json({ error: "该资产不是现金资产" }, { status: 400 });
    }

    const parsed = cashFlowSchema.parse(await req.json());
    const signedAmount = parsed.type === "deposit" ? parsed.amount : -parsed.amount;
    const now = nowCn();
    const db = getDB();
    const run = db.transaction(() => {
      const before = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow;
      const currentAmount = before.amount ?? 0;
      if (parsed.type === "expense" && parsed.amount > currentAmount + 1e-9) {
        throw new Error(`现金余额不足（余额 ${currentAmount}，消费 ${parsed.amount}）`);
      }
      const nextAmount = currentAmount + signedAmount;
      db.prepare("UPDATE asset SET amount = ?, updated_at = ? WHERE id = ?").run(nextAmount, now, id);
      const after = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow;
      logAssetChange({
        action: "update",
        before,
        after,
        extraChanges: {
          cash_flow_type: { from: null, to: parsed.type },
          cash_flow_amount: { from: 0, to: signedAmount },
          cash_flow_reason: { from: null, to: parsed.reason }
        }
      });
      recordPortfolioEvent({
        type: parsed.type === "deposit" ? "cash_deposit" : "cash_expense",
        currency: after.currency,
        grossAmount: parsed.amount,
        reason: parsed.reason,
        occurredAt: now,
        legs: [
          {
            assetId: after.id,
            accountId: after.account_id,
            assetName: after.name,
            role: "cash",
            amountDelta: signedAmount,
            amountAfter: nextAmount
          }
        ]
      });
      return after;
    });

    const asset = run();
    ensureTodaySnapshot(getSetting("base_currency") ?? "CNY");
    return NextResponse.json({ asset });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
