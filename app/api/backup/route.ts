import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { nowCn, todayCn } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDB();
  const payload = {
    version: 1,
    exported_at: nowCn(),
    category: db.prepare("SELECT * FROM category ORDER BY id").all(),
    account: db.prepare("SELECT * FROM account ORDER BY id").all(),
    asset: db.prepare("SELECT * FROM asset ORDER BY id").all(),
    fx_rate: db.prepare("SELECT * FROM fx_rate").all(),
    setting: db.prepare("SELECT * FROM setting").all(),
    asset_change: db.prepare("SELECT * FROM asset_change ORDER BY id").all(),
    portfolio_snapshot: db.prepare("SELECT * FROM portfolio_snapshot ORDER BY id").all()
  };
  const filename = `asset-backup-${todayCn()}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}

const importSchema = z.object({
  version: z.number(),
  mode: z.enum(["replace", "merge"]).default("merge").optional(),
  category: z.array(z.any()).optional(),
  account: z.array(z.any()).optional(),
  asset: z.array(z.any()).optional(),
  fx_rate: z.array(z.any()).optional(),
  setting: z.array(z.any()).optional(),
  asset_change: z.array(z.any()).optional(),
  portfolio_snapshot: z.array(z.any()).optional()
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = importSchema.parse(body);
    const db = getDB();
    const mode = parsed.mode ?? "merge";

    const tx = db.transaction(() => {
      if (mode === "replace") {
        db.exec(
          "DELETE FROM asset_change; DELETE FROM portfolio_snapshot; DELETE FROM asset; DELETE FROM account; DELETE FROM fx_rate; DELETE FROM setting;"
        );
      }
      if (parsed.category) {
        const stmt = db.prepare(
          "INSERT INTO category (id, code, name, sort_order) VALUES (@id, @code, @name, @sort_order) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, sort_order=excluded.sort_order"
        );
        for (const r of parsed.category) stmt.run(r);
      }
      if (parsed.account) {
        const stmt = db.prepare(
          "INSERT INTO account (id, category_id, name, institution, notes, created_at) VALUES (@id, @category_id, @name, @institution, @notes, @created_at) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id, name=excluded.name, institution=excluded.institution, notes=excluded.notes"
        );
        for (const r of parsed.account) stmt.run({ created_at: null, ...r });
      }
      if (parsed.asset) {
        const stmt = db.prepare(
          `INSERT INTO asset (id, account_id, name, currency, quantity, unit_cost, current_price, amount, annual_rate, start_date, maturity_date, notes, created_at, updated_at)
           VALUES (@id, @account_id, @name, @currency, @quantity, @unit_cost, @current_price, @amount, @annual_rate, @start_date, @maturity_date, @notes, @created_at, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             account_id=excluded.account_id, name=excluded.name, currency=excluded.currency,
             quantity=excluded.quantity, unit_cost=excluded.unit_cost, current_price=excluded.current_price,
             amount=excluded.amount, annual_rate=excluded.annual_rate, start_date=excluded.start_date,
             maturity_date=excluded.maturity_date, notes=excluded.notes, updated_at=excluded.updated_at`
        );
        for (const r of parsed.asset)
          stmt.run({ created_at: null, updated_at: null, amount: null, annual_rate: null, start_date: null, maturity_date: null, notes: null, unit_cost: null, current_price: null, ...r });
      }
      if (parsed.fx_rate) {
        const stmt = db.prepare(
          "INSERT INTO fx_rate (base, quote, rate, source, fetched_at) VALUES (@base, @quote, @rate, @source, @fetched_at) ON CONFLICT(base, quote) DO UPDATE SET rate=excluded.rate, source=excluded.source, fetched_at=excluded.fetched_at"
        );
        for (const r of parsed.fx_rate) stmt.run(r);
      }
      if (parsed.setting) {
        const stmt = db.prepare(
          "INSERT INTO setting (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
        );
        for (const r of parsed.setting) stmt.run(r);
      }
      if (parsed.portfolio_snapshot) {
        const stmt = db.prepare(
          "INSERT OR REPLACE INTO portfolio_snapshot (id, date, base_currency, total_value, breakdown, created_at) VALUES (@id, @date, @base_currency, @total_value, @breakdown, @created_at)"
        );
        for (const r of parsed.portfolio_snapshot) stmt.run({ breakdown: null, ...r });
      }
      if (parsed.asset_change) {
        const stmt = db.prepare(
          "INSERT OR REPLACE INTO asset_change (id, asset_id, account_id, asset_name, action, field_changes, snapshot, base_value_cny, created_at) VALUES (@id, @asset_id, @account_id, @asset_name, @action, @field_changes, @snapshot, @base_value_cny, @created_at)"
        );
        for (const r of parsed.asset_change)
          stmt.run({
            asset_id: null,
            account_id: null,
            asset_name: null,
            field_changes: null,
            snapshot: null,
            base_value_cny: null,
            ...r
          });
      }
    });
    tx();
    return NextResponse.json({ ok: true, mode });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
