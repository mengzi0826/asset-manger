import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type AssetRow, getSetting } from "@/lib/db";
import { logAssetChange, ensureTodaySnapshot } from "@/lib/history";
import { nowCn } from "@/lib/time";

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
    db.prepare(
      `UPDATE asset SET ${sets}, updated_at = @__updated_at WHERE id = @id`
    ).run({ ...patch, id, __updated_at: nowCn() });
    const after = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow;
    logAssetChange({ action: "update", before, after });
    ensureTodaySnapshot(getSetting("base_currency") ?? "CNY");
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
  db.prepare("DELETE FROM asset WHERE id = ?").run(id);
  logAssetChange({ action: "delete", before });
  ensureTodaySnapshot(getSetting("base_currency") ?? "CNY");
  return NextResponse.json({ ok: true });
}
