import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type AssetRow } from "@/lib/db";
import { logAssetChange, ensureTodaySnapshot } from "@/lib/history";
import { listAssetsWithMeta } from "@/lib/valuation";
import { getSetting } from "@/lib/db";
import { nowCn } from "@/lib/time";

export const dynamic = "force-dynamic";

const nullableNumber = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  })
  .nullable();

const nullableString = z
  .union([z.string(), z.null()])
  .transform((v) => (v == null || v === "" ? null : v))
  .nullable();

const assetSchema = z.object({
  account_id: z.number().int().positive(),
  name: z.string().trim().min(1, "名称不能为空"),
  symbol: nullableString.optional(),
  currency: z.string().trim().min(3).max(3).default("CNY"),
  quantity: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v) && v >= 0, "份额/数量无效")
    .default(1),
  unit_cost: nullableNumber.optional(),
  current_price: nullableNumber.optional(),
  amount: nullableNumber.optional(),
  annual_rate: nullableNumber.optional(),
  start_date: nullableString.optional(),
  maturity_date: nullableString.optional(),
  notes: nullableString.optional()
});

export async function GET() {
  const items = listAssetsWithMeta();
  return NextResponse.json({ assets: items });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = assetSchema.parse(body);
    const db = getDB();
    const now = nowCn();
    const res = db
      .prepare(
        `INSERT INTO asset
         (account_id, name, symbol, currency, quantity, unit_cost, current_price, amount, annual_rate, start_date, maturity_date, notes, created_at, updated_at)
         VALUES (@account_id, @name, @symbol, @currency, @quantity, @unit_cost, @current_price, @amount, @annual_rate, @start_date, @maturity_date, @notes, @created_at, @updated_at)`
      )
      .run({
        account_id: parsed.account_id,
        name: parsed.name,
        symbol: parsed.symbol ? String(parsed.symbol).toUpperCase() : null,
        currency: parsed.currency.toUpperCase(),
        quantity: parsed.quantity,
        unit_cost: parsed.unit_cost ?? null,
        current_price: parsed.current_price ?? null,
        amount: parsed.amount ?? null,
        annual_rate: parsed.annual_rate ?? null,
        start_date: parsed.start_date ?? null,
        maturity_date: parsed.maturity_date ?? null,
        notes: parsed.notes ?? null,
        created_at: now,
        updated_at: now
      });
    const asset = db.prepare("SELECT * FROM asset WHERE id = ?").get(res.lastInsertRowid) as AssetRow;
    logAssetChange({ action: "create", after: asset });
    ensureTodaySnapshot(getSetting("base_currency") ?? "CNY");
    return NextResponse.json({ asset }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
