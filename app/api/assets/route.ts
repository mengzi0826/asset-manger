import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB, type AssetRow } from "@/lib/db";
import { logAssetChange, ensureTodaySnapshot } from "@/lib/history";
import { listAssetsWithMeta } from "@/lib/valuation";
import { getSetting } from "@/lib/db";
import { nowCn } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * 通用：可空数字。允许 null / "" / 数字 / 数值字符串。
 * `min` 不为 undefined 时再做下限校验（部分字段例如 annual_rate 可以为负？
 * 当前业务里所有金额/价格都不能为负，统一收口在这里）。
 */
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
  unit_cost: nullableNonNegative.optional(),
  current_price: nullableNonNegative.optional(),
  amount: nullableNonNegative.optional(),
  // 年化利率支持负数极少见，但保留 nullableNumber 以容纳极端结构性产品
  annual_rate: nullableNumber.optional(),
  start_date: nullableString.optional(),
  maturity_date: nullableString.optional(),
  notes: nullableString.optional(),
  // 新建证券时可选：从某个同币种现金资产里扣除「份额 × 买入均价」
  cash_asset_id: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => (v == null || v === "" ? null : Number(v)))
    .refine((v) => v == null || (Number.isInteger(v) && v > 0), "现金账户无效")
    .nullable()
    .optional()
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
    const currency = parsed.currency.toUpperCase();

    // 可选：新建仓时从同币种现金资产扣款（份额 × 买入均价）
    let cash:
      | (AssetRow & { category_code: string })
      | undefined;
    let tradeValue = 0;
    if (parsed.cash_asset_id != null) {
      cash = db
        .prepare(
          `SELECT a.*, c.code AS category_code
           FROM asset a
           JOIN account acc ON acc.id = a.account_id
           JOIN category c ON c.id = acc.category_id
           WHERE a.id = ?`
        )
        .get(parsed.cash_asset_id) as (AssetRow & { category_code: string }) | undefined;
      if (!cash) return NextResponse.json({ error: "现金账户不存在" }, { status: 404 });
      if (cash.category_code !== "cash") {
        return NextResponse.json({ error: "所选账户不是现金资产" }, { status: 400 });
      }
      if (cash.currency.toUpperCase() !== currency) {
        return NextResponse.json({ error: "现金账户币种与证券币种不一致" }, { status: 400 });
      }
      if (parsed.unit_cost == null) {
        return NextResponse.json({ error: "扣款需要填写买入均价" }, { status: 400 });
      }
      tradeValue = parsed.quantity * parsed.unit_cost;
      const balance = cash.amount ?? 0;
      if (tradeValue > balance + 1e-9) {
        return NextResponse.json(
          { error: `现金余额不足（余额 ${balance}，需 ${tradeValue}）` },
          { status: 400 }
        );
      }
    }

    const run = db.transaction(() => {
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
          currency,
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
      const created = db.prepare("SELECT * FROM asset WHERE id = ?").get(res.lastInsertRowid) as AssetRow;
      logAssetChange({ action: "create", after: created });

      if (cash) {
        const cashBefore = db.prepare("SELECT * FROM asset WHERE id = ?").get(cash.id) as AssetRow;
        const nextAmount = (cashBefore.amount ?? 0) - tradeValue;
        db.prepare(
          `UPDATE asset SET amount = @amount, updated_at = @updated_at WHERE id = @id`
        ).run({ id: cash.id, amount: nextAmount, updated_at: now });
        const cashAfter = db.prepare("SELECT * FROM asset WHERE id = ?").get(cash.id) as AssetRow;
        logAssetChange({ action: "update", before: cashBefore, after: cashAfter });
      }

      return created;
    });

    const asset = run();
    ensureTodaySnapshot(getSetting("base_currency") ?? "CNY");
    return NextResponse.json({ asset }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
