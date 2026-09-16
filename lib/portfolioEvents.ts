import { getDB } from "./db";
import { nowCn } from "./time";

export type PortfolioEventType =
  | "asset_created"
  | "asset_deleted"
  | "manual_adjustment"
  | "cash_deposit"
  | "cash_expense"
  | "security_buy"
  | "security_sell"
  | "security_dividend"
  | "security_liquidation";

export type PortfolioEventSource = "user" | "system" | "import";

export interface PortfolioEventLegInput {
  assetId?: number | null;
  accountId?: number | null;
  assetName: string;
  role: "asset" | "security" | "cash";
  amountDelta?: number | null;
  amountAfter?: number | null;
  quantityDelta?: number | null;
  quantityAfter?: number | null;
  unitPrice?: number | null;
  unitCostAfter?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface PortfolioEventInput {
  type: PortfolioEventType;
  currency: string;
  grossAmount?: number | null;
  reason?: string | null;
  source?: PortfolioEventSource;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
  legs: PortfolioEventLegInput[];
}

export interface PortfolioEventLeg extends PortfolioEventLegInput {
  id: number;
  eventId: number;
}

export interface PortfolioEvent {
  id: number;
  type: PortfolioEventType;
  currency: string;
  grossAmount: number | null;
  reason: string | null;
  source: PortfolioEventSource;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
  legs: PortfolioEventLeg[];
}

function encodeMetadata(value?: Record<string, unknown> | null) {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

function decodeMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 写入统一事件。调用方应在资产更新的同一个 better-sqlite3 事务中调用，
 * 这样事件头、资产腿和余额变化会一起提交或回滚。
 */
export function recordPortfolioEvent(input: PortfolioEventInput): number {
  if (input.legs.length === 0) throw new Error("资产事件至少需要一条资产腿");
  const db = getDB();
  const occurredAt = input.occurredAt ?? nowCn();
  const result = db
    .prepare(
      `INSERT INTO portfolio_event
       (event_type, currency, gross_amount, reason, source, metadata, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.type,
      input.currency.toUpperCase(),
      input.grossAmount ?? null,
      input.reason?.trim() || null,
      input.source ?? "user",
      encodeMetadata(input.metadata),
      occurredAt,
      occurredAt
    );
  const eventId = Number(result.lastInsertRowid);
  const insertLeg = db.prepare(
    `INSERT INTO portfolio_event_leg
     (event_id, asset_id, account_id, asset_name, role,
      amount_delta, amount_after, quantity_delta, quantity_after,
      unit_price, unit_cost_after, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const leg of input.legs) {
    insertLeg.run(
      eventId,
      leg.assetId ?? null,
      leg.accountId ?? null,
      leg.assetName,
      leg.role,
      leg.amountDelta ?? null,
      leg.amountAfter ?? null,
      leg.quantityDelta ?? null,
      leg.quantityAfter ?? null,
      leg.unitPrice ?? null,
      leg.unitCostAfter ?? null,
      encodeMetadata(leg.metadata)
    );
  }
  return eventId;
}

export function listPortfolioEvents(options: {
  fromDate?: string;
  toDate?: string;
  types?: PortfolioEventType[];
  limit?: number;
} = {}): PortfolioEvent[] {
  const db = getDB();
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (options.fromDate) {
    where.push("substr(occurred_at, 1, 10) >= ?");
    args.push(options.fromDate);
  }
  if (options.toDate) {
    where.push("substr(occurred_at, 1, 10) <= ?");
    args.push(options.toDate);
  }
  if (options.types?.length) {
    where.push(`event_type IN (${options.types.map(() => "?").join(",")})`);
    args.push(...options.types);
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500), 1), 5000);
  const rows = db
    .prepare(
      `SELECT * FROM portfolio_event
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    )
    .all(...args, limit) as Array<{
      id: number;
      event_type: PortfolioEventType;
      currency: string;
      gross_amount: number | null;
      reason: string | null;
      source: PortfolioEventSource;
      metadata: string | null;
      occurred_at: string;
      created_at: string;
    }>;
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const legs = db
    .prepare(`SELECT * FROM portfolio_event_leg WHERE event_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`)
    .all(...ids) as Array<{
      id: number;
      event_id: number;
      asset_id: number | null;
      account_id: number | null;
      asset_name: string;
      role: "asset" | "security" | "cash";
      amount_delta: number | null;
      amount_after: number | null;
      quantity_delta: number | null;
      quantity_after: number | null;
      unit_price: number | null;
      unit_cost_after: number | null;
      metadata: string | null;
    }>;
  const legsByEvent = new Map<number, PortfolioEventLeg[]>();
  for (const leg of legs) {
    const list = legsByEvent.get(leg.event_id) ?? [];
    list.push({
      id: leg.id,
      eventId: leg.event_id,
      assetId: leg.asset_id,
      accountId: leg.account_id,
      assetName: leg.asset_name,
      role: leg.role,
      amountDelta: leg.amount_delta,
      amountAfter: leg.amount_after,
      quantityDelta: leg.quantity_delta,
      quantityAfter: leg.quantity_after,
      unitPrice: leg.unit_price,
      unitCostAfter: leg.unit_cost_after,
      metadata: decodeMetadata(leg.metadata)
    });
    legsByEvent.set(leg.event_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    type: row.event_type,
    currency: row.currency,
    grossAmount: row.gross_amount,
    reason: row.reason,
    source: row.source,
    metadata: decodeMetadata(row.metadata),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    legs: legsByEvent.get(row.id) ?? []
  }));
}

export function getPortfolioEventCoverage(): {
  count: number;
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
} {
  const row = getDB()
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(occurred_at) AS first_occurred_at,
              MAX(occurred_at) AS last_occurred_at
       FROM portfolio_event`
    )
    .get() as { count: number; first_occurred_at: string | null; last_occurred_at: string | null };
  return {
    count: row.count,
    firstOccurredAt: row.first_occurred_at,
    lastOccurredAt: row.last_occurred_at
  };
}
