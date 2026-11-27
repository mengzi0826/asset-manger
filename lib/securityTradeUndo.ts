import { getDB, type AssetRow } from "./db";
import { logAssetChange } from "./history";
import { listPortfolioEvents, recordPortfolioEvent, type PortfolioEventLegInput } from "./portfolioEvents";
import { portfolioTransaction } from "./portfolioMutations";
import { nowCn } from "./time";

const labels = { security_buy: "增持", security_sell: "减持", security_dividend: "分红", security_liquidation: "清仓" } as const;

export function lastSecuritySubmission(assetId: number) {
  const row = getDB().prepare(`SELECT e.id, e.event_type AS type, e.gross_amount AS amount,
    e.currency, e.occurred_at AS at, e.metadata, e.source,
    (SELECT asset_name FROM portfolio_event_leg WHERE event_id=e.id AND role='cash' LIMIT 1) AS cashName,
    (SELECT amount_delta FROM portfolio_event_leg WHERE event_id=e.id AND role='cash' LIMIT 1) AS cashDelta
    FROM portfolio_event e JOIN portfolio_event_leg l ON l.event_id=e.id
    WHERE l.asset_id=? ORDER BY e.id DESC LIMIT 1`).get(assetId) as {
      id: number; type: keyof typeof labels; amount: number; currency: string; at: string;
      metadata: string | null; source: string; cashName: string | null; cashDelta: number | null;
    } | undefined;
  if (!row || row.source !== "user" || !Object.hasOwn(labels, row.type)) return null;
  let meta;
  try { meta = JSON.parse(row.metadata ?? "null"); } catch { return null; }
  if (!meta || meta.undone_at || !Object.hasOwn(meta, "unit_cost_before")) return null;
  if (row.type !== "security_dividend" && !Number.isFinite(meta.quantity_before)) return null;
  return { id: row.id, type: row.type, label: labels[row.type], amount: row.amount, currency: row.currency, at: row.at,
    cashName: row.cashName, cashDelta: row.cashDelta };
}

function getAsset(id: number) {
  return getDB().prepare(`SELECT a.*, c.code AS category_code FROM asset a
    JOIN account b ON b.id=a.account_id JOIN category c ON c.id=b.category_id WHERE a.id=?`)
    .get(id) as (AssetRow & { category_code: string }) | undefined;
}

function restoreLiquidation(assetId: number, at: string, accountId: number, currency: string,
  name: string, quantity: number, cost: number | null, logId: unknown, now: string) {
  const db = getDB();
  const log = db.prepare("SELECT id, action, snapshot, created_at FROM asset_change WHERE asset_id=? ORDER BY id DESC LIMIT 1")
    .get(assetId) as { id: number; action: string; snapshot: string; created_at: string } | undefined;
  if (!log || log.action !== "delete" || log.created_at !== at || (logId != null && logId !== log.id)) {
    throw new Error("缺少可核实的清仓前持仓快照。");
  }
  const row = JSON.parse(log.snapshot) as AssetRow & {category_code: string};
  if (row.id !== assetId || row.account_id !== accountId || row.currency !== currency || row.name !== name ||
      row.category_code !== "securities" || row.quantity !== quantity || row.unit_cost !== cost) {
    throw new Error("清仓快照与交易不一致。");
  }
  if (!db.prepare(`SELECT 1 FROM account a JOIN category c ON c.id=a.category_id
    WHERE a.id=? AND c.code='securities'`).get(accountId)) throw new Error("原证券账户已删除或变更分类。");
  // Restore the same historical identity, including its symbol and last actual quote.
  const columns = ["id", "account_id", "name", "symbol", "currency", "quantity", "unit_cost", "current_price",
    "change_amount", "change_percent", "change_updated_at", "change_quote_date", "amount", "annual_rate",
    "start_date", "maturity_date", "notes", "created_at", "updated_at"];
  db.prepare(`INSERT INTO asset (${columns.join(",")}) VALUES (${columns.map(key => "@"+key).join(",")})`)
    .run({ ...row, updated_at: now });
  return getAsset(assetId)!;
}

export function undoSecurityTrade(assetId: number, eventId: number) {
  return portfolioTransaction(() => {
    const db = getDB();
    const target = lastSecuritySubmission(assetId);
    if (target?.id !== eventId) throw new Error("持仓记录已变更，请刷新后核对最近一次交易。");
    const [event] = listPortfolioEvents({ eventId });
    const security = event.legs.find(leg => leg.role === "security" && leg.assetId === assetId);
    const cash = event.legs.find(leg => leg.role === "cash");
    const meta = event.metadata!;
    const dividend = target.type === "security_dividend";
    const liquidation = target.type === "security_liquidation";
    const quantity = dividend ? security?.quantityAfter : meta.quantity_before;
    const cost = meta.unit_cost_before;
    if (!security || security.accountId == null || event.legs.length !== (cash ? 2 : 1) ||
        (dividend && !cash) || (!dividend && Boolean(cash) !== meta.cash_linked) ||
        typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0 ||
        !(cost === null || (typeof cost === "number" && Number.isFinite(cost))) ||
        !Number.isFinite(event.grossAmount) || event.grossAmount! < 0 ||
        (!dividend && (security.quantityDelta == null || security.quantityAfter == null || security.unitPrice == null ||
          Math.abs(quantity + security.quantityDelta - security.quantityAfter) > 1e-8 ||
          Math.abs(Math.abs(security.quantityDelta) * security.unitPrice - event.grossAmount!) > 1e-7))) {
      throw new Error("交易前数据不完整，无法核实撤回金额或份额。");
    }
    const now = nowCn();
    const reason = `撤回${target.label} · ${security.assetName}`;
    const extraChanges = { security_trade_undo: { from: null, to: reason } };
    const before = getAsset(assetId);
    let after: AssetRow;
    if (liquidation) {
      if (before) throw new Error("原持仓 ID 已存在，无法恢复清仓记录。");
      after = restoreLiquidation(assetId, event.occurredAt, security.accountId, event.currency,
        security.assetName, quantity, cost, meta.deletion_log_id, now);
      logAssetChange({ action: "create", after, extraChanges: {
        ...extraChanges,
        ...(now.slice(0, 10) > event.occurredAt.slice(0, 10) ? { quantity: { from: 0, to: quantity } } : {})
      } });
    } else {
      if (!before || before.category_code !== "securities" || before.currency !== event.currency ||
          before.account_id !== security.accountId || before.quantity !== security.quantityAfter ||
          before.unit_cost !== security.unitCostAfter) throw new Error("持仓份额、成本或账户已变更，无法撤回。");
      db.prepare("UPDATE asset SET quantity=?, unit_cost=?, updated_at=? WHERE id=?").run(quantity, cost, now, assetId);
      after = getAsset(assetId)!;
      logAssetChange({ action: "update", before, after, extraChanges });
    }
    const legs: PortfolioEventLegInput[] = [{ role: "security", assetId, accountId: after.account_id,
      assetName: after.name, quantityDelta: dividend ? null : -security.quantityDelta!, quantityAfter: quantity,
      unitCostAfter: cost, unitPrice: security.unitPrice }];
    if (cash) {
      const account = cash.assetId == null ? undefined : getAsset(cash.assetId);
      const delta = cash.amountDelta;
      if (!account || account.category_code !== "cash" || account.currency !== event.currency ||
          delta == null || delta !== (target.type === "security_buy" ? -event.grossAmount! : event.grossAmount) ||
          db.prepare("SELECT 1 FROM asset_change WHERE asset_id=? AND action='delete' AND created_at>=? LIMIT 1")
            .get(account.id, event.occurredAt)) throw new Error("原关联现金资产或金额无法核实。");
      const balance = (account.amount ?? 0) - delta;
      if (balance < -1e-9) throw new Error("关联现金余额不足，无法撤回这笔交易。");
      const amount = Math.max(0, balance);
      db.prepare("UPDATE asset SET amount=?, updated_at=? WHERE id=?").run(amount, now, account.id);
      logAssetChange({ action: "update", before: account, after: getAsset(account.id), extraChanges });
      legs.push({ role: "cash", assetId: account.id, accountId: account.account_id, assetName: account.name,
        amountDelta: -delta, amountAfter: amount });
    }
    db.prepare("UPDATE portfolio_event SET metadata=json_set(metadata,'$.undone_at',?) WHERE id=?").run(now,eventId);
    recordPortfolioEvent({ type: "security_trade_undo", occurredAt: now, currency: event.currency,
      grossAmount: event.grossAmount, reason, metadata: { reverses_event_id: event.id, original_type: target.type }, legs });
    return { assetId };
  })();
}
