import { getDB, type AssetRow } from "./db";
import { logAssetChange } from "./history";
import { recordPortfolioEvent } from "./portfolioEvents";
import { portfolioTransaction } from "./portfolioMutations";
import { nowCn } from "./time";

export interface UndoableCashFlow {
  eventId: number;
  changeId: number;
  currency: string;
  delta: number;
  reason: string;
  occurredAt: string;
  eventType: "cash_deposit" | "cash_expense";
}

export function lastManualCashFlow(assetId: number): UndoableCashFlow | null {
  const db = getDB();
  const event = db.prepare(`
    SELECT e.id AS eventId, e.event_type AS eventType, e.reason, e.currency, e.occurred_at AS occurredAt,
      l.amount_delta AS delta, l.amount_after AS balance, e.gross_amount AS gross,
      CASE WHEN json_valid(e.metadata) THEN json_extract(e.metadata, '$.cash_flow_change_id') END AS linkedChange
    FROM portfolio_event_leg l JOIN portfolio_event e ON e.id = l.event_id
    WHERE l.asset_id = ? AND l.role = 'cash' AND e.source = 'user'
      AND e.event_type IN ('cash_deposit', 'cash_expense')
    ORDER BY e.id DESC LIMIT 1
  `).get(assetId) as (Omit<UndoableCashFlow, "changeId"> & {
    balance: number; gross: number; linkedChange: number | null;
  }) | undefined;
  if (!event || !(event.gross > 0) || !Number.isFinite(event.delta)) return null;
  const type = event.eventType === "cash_deposit" ? "deposit" : "expense";
  if (event.delta !== (type === "deposit" ? event.gross : -event.gross)) return null;
  const log = db.prepare(`
    SELECT id, created_at, field_changes, snapshot FROM asset_change
    WHERE asset_id = ? AND action = 'update' AND CASE WHEN json_valid(field_changes)
      THEN json_extract(field_changes, '$.cash_flow_type.to') END IN ('deposit', 'expense')
    ORDER BY id DESC LIMIT 1
  `).get(assetId) as {id: number; created_at: string; field_changes: string; snapshot: string} | undefined;
  if (!log || (event.linkedChange != null && event.linkedChange !== log.id)) return null;
  if (db.prepare("SELECT 1 FROM asset_change WHERE asset_id = ? AND action IN ('create', 'delete') AND id > ? LIMIT 1")
    .get(assetId, log.id)) return null;
  const fields = JSON.parse(log.field_changes);
  let snapshot;
  try { snapshot = JSON.parse(log.snapshot); } catch { return null; }
  // Earlier submissions already logged their type, signed amount, reason and balance atomically.
  if (fields.cash_flow_reversed_at || fields.cash_flow_type?.to !== type ||
      fields.cash_flow_amount?.to !== event.delta || fields.cash_flow_reason?.to !== event.reason ||
      log.created_at !== event.occurredAt || snapshot?.currency !== event.currency ||
      snapshot?.amount !== event.balance || snapshot?.id !== assetId) return null;
  return { eventId: event.eventId, changeId: log.id, occurredAt: event.occurredAt,
    currency: event.currency, delta: event.delta, eventType: event.eventType, reason: event.reason };
}

export function undoLastCashFlow(assetId: number, eventId: number, changeId: number) {
  return portfolioTransaction(() => {
    const db = getDB();
    const flow = lastManualCashFlow(assetId);
    if (!flow || flow.eventId !== eventId || flow.changeId !== changeId) {
      throw new Error("这笔收支已撤回或已有新的提交，请刷新后核对。");
    }
    const before = db.prepare(`SELECT a.* FROM asset a JOIN account acc ON acc.id = a.account_id
      JOIN category c ON c.id = acc.category_id WHERE a.id = ? AND c.code = 'cash'`).get(assetId) as AssetRow | undefined;
    if (!before || before.currency !== flow.currency) throw new Error("资产类别或币种已变更，无法撤回。");
    const balance = (before.amount ?? 0) - flow.delta;
    if (balance < -1e-9) throw new Error("当前余额不足以撤回这笔入金。");
    const now = nowCn();
    const after = { ...before, amount: Math.max(balance, 0), updated_at: now };
    db.prepare("UPDATE asset SET amount = ?, updated_at = ? WHERE id = ?").run(after.amount, now, assetId);
    db.prepare(`UPDATE asset_change SET field_changes = json_set(field_changes, '$.cash_flow_reversed_at',
      json_object('from', NULL, 'to', ?)) WHERE id = ?`).run(now, changeId);
    const reason = `撤回${flow.delta > 0 ? "入金" : "消费"}：${flow.reason}`;
    logAssetChange({ action: "update", before, after, extraChanges: {
      cash_flow_undo: { from: null, to: reason }
    } });
    recordPortfolioEvent({
      type: flow.eventType, grossAmount: -Math.abs(flow.delta), currency: flow.currency,
      occurredAt: now, reason, metadata: { reverses_event_id: eventId, original_occurred_at: flow.occurredAt },
      legs: [{ assetId, accountId: before.account_id, assetName: before.name, role: "cash",
        amountDelta: -flow.delta, amountAfter: after.amount }]
    });
    return after;
  })();
}
