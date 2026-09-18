import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type AssetRow } from "@/lib/db";
import { logAssetChange } from "@/lib/history";
import { recordPortfolioEvent } from "@/lib/portfolioEvents";
import { portfolioTransaction } from "@/lib/portfolioMutations";
import { nowCn } from "@/lib/time";
import { computeAssetValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";

function makeNullableNumber(min?: number) {
  return z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    })
    .refine(
      (v) => v == null || min === undefined || v >= min,
      min !== undefined ? `数值不能小于 ${min}` : "数值无效"
    )
    .nullable();
}

const nullableNumber = makeNullableNumber();
const nullableNonNegative = makeNullableNumber(0);

const nullableString = z
  .union([z.string(), z.null()])
  .transform((v) => (v == null || v === "" ? null : v))
  .nullable();

const patchSchema = z.object({
  account_id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).optional(),
  symbol: nullableString.optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  quantity: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, "份额/数量无效")
    .optional(),
  unit_cost: nullableNonNegative.optional(),
  current_price: nullableNonNegative.optional(),
  amount: nullableNonNegative.optional(),
  annual_rate: nullableNumber.optional(),
  start_date: nullableString.optional(),
  maturity_date: nullableString.optional(),
  notes: nullableString.optional()
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const db = getDB();
  const row = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ asset: row });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const db = getDB();
    const before = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow | undefined;
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    const patch: Record<string, any> = { ...parsed };
    if (patch.currency) patch.currency = String(patch.currency).toUpperCase();
    if (patch.symbol != null) patch.symbol = String(patch.symbol).toUpperCase();
    const keys = Object.keys(patch);
    if (keys.length === 0) return NextResponse.json({ asset: before });
    const sets = keys.map((k) => `${k} = @${k}`).join(", ");
    const now = nowCn();
    const run = portfolioTransaction(() => {
      const beforeCategory = db.prepare(`SELECT c.code FROM account acc JOIN category c ON c.id = acc.category_id WHERE acc.id = ?`)
        .get(before.account_id) as { code: string };
      db.prepare(
        `UPDATE asset SET ${sets}, updated_at = @__updated_at WHERE id = @id`
      ).run({ ...patch, id, __updated_at: now });
      const after = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow;
      logAssetChange({ action: "update", before, after });

      const economicFields = ["amount", "quantity", "unit_cost", "current_price", "currency", "account_id", "symbol"] as const;
      const changedEconomicFields = economicFields.filter((key) => before[key] !== after[key]);
      if (changedEconomicFields.length > 0) {
        const category = db
          .prepare(
            `SELECT c.code FROM account acc
             JOIN category c ON c.id = acc.category_id
             WHERE acc.id = ?`
          )
          .get(after.account_id) as { code: string } | undefined;
        const amountChanged = before.amount !== after.amount;
        const quantityChanged = before.quantity !== after.quantity;
        const amountDelta = amountChanged ? (after.amount ?? 0) - (before.amount ?? 0) : null;
        const quantityDelta = quantityChanged ? (after.quantity ?? 0) - (before.quantity ?? 0) : null;
        const unitPrice = after.current_price ?? after.unit_cost ?? 0;
        recordPortfolioEvent({
          type: "manual_adjustment",
          currency: after.currency,
          grossAmount:
            amountDelta != null
              ? Math.abs(amountDelta)
              : quantityDelta != null
                ? Math.abs(quantityDelta * unitPrice)
                : null,
          reason: "手动编辑资产",
          occurredAt: now,
          metadata: {
            classification: "record_adjustment",
            native_value_before: computeAssetValue(before),
            native_value_after: computeAssetValue(after),
            category_before: beforeCategory.code,
            category_after: category?.code ?? null,
            currency_before: before.currency,
            currency_after: after.currency,
            fields: changedEconomicFields,
            changes: Object.fromEntries(changedEconomicFields.map(key => [key, { from: before[key], to: after[key] }]))
          },
          legs: [
            {
              assetId: after.id,
              accountId: after.account_id,
              assetName: after.name,
              role: category?.code === "cash" ? "cash" : category?.code === "securities" ? "security" : "asset",
              amountDelta,
              amountAfter: amountChanged ? after.amount : null,
              quantityDelta,
              quantityAfter: quantityChanged ? after.quantity : null,
              unitPrice: changedEconomicFields.includes("current_price") ? after.current_price : null,
              unitCostAfter: changedEconomicFields.includes("unit_cost") ? after.unit_cost : null
            }
          ]
        });
      }
      return after;
    });
    const after = run();
    return NextResponse.json({ asset: after });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const db = getDB();
  const before = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow | undefined;
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  const now = nowCn();
  const run = portfolioTransaction(() => {
    const category = db
      .prepare(
        `SELECT c.code FROM account acc
         JOIN category c ON c.id = acc.category_id
         WHERE acc.id = ?`
      )
      .get(before.account_id) as { code: string } | undefined;
    const isSecurity = category?.code === "securities";
    recordPortfolioEvent({
      type: "asset_deleted",
      currency: before.currency,
      grossAmount: computeAssetValue(before),
      reason: "删除资产",
      occurredAt: now,
      metadata: { category_code: category?.code ?? null },
      legs: [
        {
          assetId: before.id,
          accountId: before.account_id,
          assetName: before.name,
          role: category?.code === "cash" ? "cash" : isSecurity ? "security" : "asset",
          amountDelta: !isSecurity && before.amount != null ? -before.amount : null,
          amountAfter: !isSecurity && before.amount != null ? 0 : null,
          quantityDelta: isSecurity ? -(before.quantity ?? 0) : null,
          quantityAfter: isSecurity ? 0 : null,
          unitPrice: isSecurity ? before.current_price ?? before.unit_cost : null,
          unitCostAfter: isSecurity ? before.unit_cost : null
        }
      ]
    });
    db.prepare("DELETE FROM asset WHERE id = ?").run(id);
    logAssetChange({ action: "delete", before });
  });
  run();
  return NextResponse.json({ ok: true });
}
