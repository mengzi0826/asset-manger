import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { nowCn, todayCn } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDB();
  const payload = {
    version: 4,
    exported_at: nowCn(),
    category: db.prepare("SELECT * FROM category ORDER BY id").all(),
    account: db.prepare("SELECT * FROM account ORDER BY id").all(),
    asset: db.prepare("SELECT * FROM asset ORDER BY id").all(),
    fx_rate: db.prepare("SELECT * FROM fx_rate").all(),
    fx_rate_history: db
      .prepare("SELECT * FROM fx_rate_history ORDER BY observed_at, base, quote")
      .all(),
    setting: db.prepare("SELECT * FROM setting").all(),
    asset_change: db.prepare("SELECT * FROM asset_change ORDER BY id").all(),
    portfolio_event: db.prepare("SELECT * FROM portfolio_event ORDER BY id").all(),
    portfolio_event_leg: db.prepare("SELECT * FROM portfolio_event_leg ORDER BY id").all(),
    portfolio_snapshot: db.prepare("SELECT * FROM portfolio_snapshot ORDER BY id").all(),
    asset_valuation_daily: db
      .prepare(
        "SELECT * FROM asset_valuation_daily ORDER BY date, base_currency, asset_id"
      )
      .all(),
    stock_price_daily: db.prepare("SELECT * FROM stock_price_daily ORDER BY asset_id, date").all()
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
  fx_rate_history: z.array(z.any()).optional(),
  setting: z.array(z.any()).optional(),
  asset_change: z.array(z.any()).optional(),
  portfolio_event: z.array(z.any()).optional(),
  portfolio_event_leg: z.array(z.any()).optional(),
  portfolio_snapshot: z.array(z.any()).optional(),
  asset_valuation_daily: z.array(z.any()).optional(),
  stock_price_daily: z.array(z.any()).optional()
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
          "DELETE FROM stock_refresh_log; DELETE FROM stock_price_daily; DELETE FROM asset_valuation_daily; DELETE FROM portfolio_event_leg; DELETE FROM portfolio_event; DELETE FROM asset_change; DELETE FROM portfolio_snapshot; DELETE FROM asset; DELETE FROM account; DELETE FROM fx_rate_history; DELETE FROM fx_rate; DELETE FROM setting;"
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
          `INSERT INTO asset (id, account_id, name, symbol, currency, quantity,
                              unit_cost, current_price, change_amount, change_percent,
                              change_updated_at, change_quote_date, amount, annual_rate, start_date,
                              maturity_date, notes, created_at, updated_at)
           VALUES (@id, @account_id, @name, @symbol, @currency, @quantity,
                   @unit_cost, @current_price, @change_amount, @change_percent,
                   @change_updated_at, @change_quote_date, @amount, @annual_rate, @start_date,
                   @maturity_date, @notes, @created_at, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             account_id=excluded.account_id, name=excluded.name, symbol=excluded.symbol,
             currency=excluded.currency, quantity=excluded.quantity,
             unit_cost=excluded.unit_cost, current_price=excluded.current_price,
             change_amount=excluded.change_amount, change_percent=excluded.change_percent,
             change_updated_at=excluded.change_updated_at,
             change_quote_date=excluded.change_quote_date, amount=excluded.amount,
             annual_rate=excluded.annual_rate, start_date=excluded.start_date,
             maturity_date=excluded.maturity_date, notes=excluded.notes,
             updated_at=excluded.updated_at`
        );
        for (const r of parsed.asset)
          stmt.run({
            symbol: null,
            change_amount: null,
            change_percent: null,
            change_updated_at: null,
            change_quote_date: null,
            unit_cost: null,
            current_price: null,
            amount: null,
            annual_rate: null,
            start_date: null,
            maturity_date: null,
            notes: null,
            created_at: null,
            updated_at: null,
            ...r
          });
      }
      if (parsed.fx_rate) {
        const stmt = db.prepare(
          "INSERT INTO fx_rate (base, quote, rate, source, fetched_at) VALUES (@base, @quote, @rate, @source, @fetched_at) ON CONFLICT(base, quote) DO UPDATE SET rate=excluded.rate, source=excluded.source, fetched_at=excluded.fetched_at"
        );
        const historyStmt = db.prepare(
          `INSERT INTO fx_rate_history (base, quote, rate, source, observed_at)
           VALUES (@base, @quote, @rate, @source, @fetched_at)
           ON CONFLICT(base, quote, observed_at) DO UPDATE SET
             rate=excluded.rate, source=excluded.source`
        );
        for (const r of parsed.fx_rate) {
          stmt.run(r);
          // 老版备份没有历史表时，至少精确保留 fx_rate 自带的最近观测点。
          historyStmt.run(r);
        }
      }
      if (parsed.fx_rate_history) {
        const stmt = db.prepare(
          `INSERT INTO fx_rate_history (base, quote, rate, source, observed_at)
           VALUES (@base, @quote, @rate, @source, @observed_at)
           ON CONFLICT(base, quote, observed_at) DO UPDATE SET
             rate=excluded.rate, source=excluded.source`
        );
        for (const r of parsed.fx_rate_history) stmt.run(r);
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
      if (parsed.asset_valuation_daily) {
        const stmt = db.prepare(
          `INSERT INTO asset_valuation_daily
           (date, base_currency, asset_id, account_id, asset_name, category_code,
            currency, quantity, unit_cost, unit_price, amount, native_value,
            fx_rate, base_value, captured_at)
           VALUES (@date, @base_currency, @asset_id, @account_id, @asset_name, @category_code,
                   @currency, @quantity, @unit_cost, @unit_price, @amount, @native_value,
                   @fx_rate, @base_value, @captured_at)
           ON CONFLICT(date, base_currency, asset_id) DO UPDATE SET
             account_id=excluded.account_id, asset_name=excluded.asset_name,
             category_code=excluded.category_code, currency=excluded.currency,
             quantity=excluded.quantity, unit_cost=excluded.unit_cost,
             unit_price=excluded.unit_price, amount=excluded.amount,
             native_value=excluded.native_value, fx_rate=excluded.fx_rate,
             base_value=excluded.base_value, captured_at=excluded.captured_at`
        );
        for (const r of parsed.asset_valuation_daily)
          stmt.run({
            quantity: null,
            unit_cost: null,
            unit_price: null,
            amount: null,
            fx_rate: null,
            ...r
          });
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
      if (parsed.portfolio_event) {
        const stmt = db.prepare(
          `INSERT INTO portfolio_event
           (id, event_type, currency, gross_amount, reason, source, metadata, occurred_at, created_at)
           VALUES (@id, @event_type, @currency, @gross_amount, @reason, @source, @metadata, @occurred_at, @created_at)
           ON CONFLICT(id) DO UPDATE SET
             event_type=excluded.event_type, currency=excluded.currency,
             gross_amount=excluded.gross_amount, reason=excluded.reason,
             source=excluded.source, metadata=excluded.metadata,
             occurred_at=excluded.occurred_at, created_at=excluded.created_at`
        );
        for (const r of parsed.portfolio_event)
          stmt.run({
            gross_amount: null,
            reason: null,
            source: "import",
            metadata: null,
            created_at: r.occurred_at,
            ...r
          });
      }
      if (parsed.portfolio_event_leg) {
        const stmt = db.prepare(
          `INSERT INTO portfolio_event_leg
           (id, event_id, asset_id, account_id, asset_name, role,
            amount_delta, amount_after, quantity_delta, quantity_after,
            unit_price, unit_cost_after, metadata)
           VALUES (@id, @event_id, @asset_id, @account_id, @asset_name, @role,
                   @amount_delta, @amount_after, @quantity_delta, @quantity_after,
                   @unit_price, @unit_cost_after, @metadata)
           ON CONFLICT(id) DO UPDATE SET
             event_id=excluded.event_id, asset_id=excluded.asset_id,
             account_id=excluded.account_id, asset_name=excluded.asset_name,
             role=excluded.role, amount_delta=excluded.amount_delta,
             amount_after=excluded.amount_after, quantity_delta=excluded.quantity_delta,
             quantity_after=excluded.quantity_after, unit_price=excluded.unit_price,
             unit_cost_after=excluded.unit_cost_after, metadata=excluded.metadata`
        );
        for (const r of parsed.portfolio_event_leg)
          stmt.run({
            asset_id: null,
            account_id: null,
            amount_delta: null,
            amount_after: null,
            quantity_delta: null,
            quantity_after: null,
            unit_price: null,
            unit_cost_after: null,
            metadata: null,
            ...r
          });
      }
      if (parsed.stock_price_daily) {
        const stmt = db.prepare(
          `INSERT INTO stock_price_daily (asset_id, date, price)
           VALUES (@asset_id, @date, @price)
           ON CONFLICT(asset_id, date) DO UPDATE SET price = excluded.price`
        );
        for (const r of parsed.stock_price_daily) stmt.run(r);
      }
    });
    tx();
    return NextResponse.json({ ok: true, mode });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}
