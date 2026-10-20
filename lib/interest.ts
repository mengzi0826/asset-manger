import "server-only";
import { getDB, getSetting, setSetting, type AssetRow } from "./db";
import { logAssetChange, recordSnapshot } from "./history";
import { allocateEntityId } from "./identity";
import {
  INTEREST_BUCKETS,
  INTEREST_DAY_COUNT,
  dailyInterest,
  interestNote,
  moneyCents,
  normalizeAnnualRate,
  type InterestBucket,
  type InterestBucketId,
  type InterestBucketStatus
} from "./interestMath";
import { recordPortfolioEvent } from "./portfolioEvents";
import { nowCn, todayCn } from "./time";
import { computeAssetValue } from "./valuation";

export {
  INTEREST_BUCKETS,
  INTEREST_DAY_COUNT,
  dailyInterest,
  type InterestBucketId,
  type InterestBucketStatus
} from "./interestMath";

interface AccrualRow {
  date: string;
  bucket: InterestBucketId;
  annual_rate: number;
  principal: number;
  interest: number;
  asset_id: number;
  event_id: number | null;
  created_at: string;
}

let accruing = false;

function readRate(bucket: InterestBucket): number {
  const raw = getSetting(bucket.settingKey);
  if (raw == null || raw.trim() === "") return 0;
  return normalizeAnnualRate(Number(raw));
}

function settingAssetKey(id: InterestBucketId) {
  return `interest_asset_${id}`;
}

function findInterestAsset(bucket: InterestBucket): AssetRow | undefined {
  const db = getDB();
  const saved = Number(getSetting(settingAssetKey(bucket.id)));
  if (Number.isInteger(saved) && saved > 0) {
    const row = db
      .prepare(
        `SELECT a.* FROM asset a
         JOIN account acc ON acc.id = a.account_id
         JOIN category c ON c.id = acc.category_id
         WHERE a.id = ? AND c.code = ?`
      )
      .get(saved, bucket.category) as AssetRow | undefined;
    if (row) return row;
  }
  return db
    .prepare(
      `SELECT a.* FROM asset a
       JOIN account acc ON acc.id = a.account_id
       JOIN category c ON c.id = acc.category_id
       WHERE acc.notes = ? AND c.code = ?
       ORDER BY a.id ASC LIMIT 1`
    )
    .get(interestNote(bucket.id), bucket.category) as AssetRow | undefined;
}

function readAccrual(date: string, bucket: InterestBucketId): AccrualRow | undefined {
  return getDB()
    .prepare("SELECT * FROM interest_accrual WHERE date = ? AND bucket = ?")
    .get(date, bucket) as AccrualRow | undefined;
}

/** 该币种现金，或美元计价的加密货币。利息账户余额计入本金，次日复利。 */
function principalOf(bucket: InterestBucket): number {
  const rows = getDB()
    .prepare(
      `SELECT a.* FROM asset a
       JOIN account acc ON acc.id = a.account_id
       JOIN category c ON c.id = acc.category_id
       WHERE c.code = ? AND UPPER(a.currency) = ?`
    )
    .all(bucket.category, bucket.currency) as AssetRow[];
  return rows.reduce((sum, row) => sum + computeAssetValue(row), 0);
}

function createInterestAccount(bucket: InterestBucket): AssetRow {
  const db = getDB();
  const category = db.prepare("SELECT id FROM category WHERE code = ?").get(bucket.category) as
    | { id: number }
    | undefined;
  if (!category) throw new Error(`缺少分类 ${bucket.category}`);
  const now = nowCn();
  const accountId = allocateEntityId(db, "account");
  db.prepare(
    "INSERT INTO account (id, category_id, name, institution, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(accountId, category.id, bucket.label, null, interestNote(bucket.id), now);
  const assetId = allocateEntityId(db, "asset");
  db.prepare(
    `INSERT INTO asset
     (id, account_id, name, symbol, currency, quantity, unit_cost, current_price, amount,
      annual_rate, start_date, maturity_date, notes, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 0, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?, ?)`
  ).run(assetId, accountId, bucket.label, bucket.currency, now, now);
  const created = db.prepare("SELECT * FROM asset WHERE id = ?").get(assetId) as AssetRow;
  logAssetChange({ action: "create", after: created });
  recordPortfolioEvent({
    type: "asset_created",
    currency: bucket.currency,
    grossAmount: 0,
    reason: "建立利息账户",
    source: "system",
    occurredAt: now,
    metadata: { category_code: bucket.category, bucket: bucket.id },
    legs: [
      {
        assetId: created.id,
        accountId: created.account_id,
        assetName: created.name,
        role: bucket.category === "cash" ? "cash" : "asset",
        amountDelta: 0,
        amountAfter: 0
      }
    ]
  });
  setSetting(settingAssetKey(bucket.id), String(created.id));
  return created;
}

function ensureInterestAccounts(): boolean {
  let created = false;
  for (const bucket of INTEREST_BUCKETS) {
    const existing = findInterestAsset(bucket);
    if (existing) {
      if (getSetting(settingAssetKey(bucket.id)) !== String(existing.id)) {
        setSetting(settingAssetKey(bucket.id), String(existing.id));
      }
      continue;
    }
    createInterestAccount(bucket);
    created = true;
  }
  return created;
}

function interestMetadata(bucket: InterestBucket, annualRate: number, principal: number) {
  return {
    bucket: bucket.id,
    annual_rate: annualRate,
    principal,
    day_count: INTEREST_DAY_COUNT,
    category_code: bucket.category,
    classification: "interest_income"
  };
}

function writeInterestEvent(asset: AssetRow, bucket: InterestBucket, interest: number, amountAfter: number, annualRate: number, principal: number) {
  return recordPortfolioEvent({
    type: "interest_income",
    currency: asset.currency,
    grossAmount: interest,
    reason: "利息收入",
    source: "system",
    occurredAt: nowCn(),
    metadata: interestMetadata(bucket, annualRate, principal),
    legs: [
      {
        assetId: asset.id,
        accountId: asset.account_id,
        assetName: asset.name,
        role: bucket.category === "cash" ? "cash" : "asset",
        amountDelta: interest,
        amountAfter
      }
    ]
  });
}

function applyBalance(asset: AssetRow, nextAmount: number, signed: number, annualRate: number, principal: number) {
  const db = getDB();
  const now = nowCn();
  db.prepare("UPDATE asset SET amount = ?, updated_at = ? WHERE id = ?").run(nextAmount, now, asset.id);
  const after = db.prepare("SELECT * FROM asset WHERE id = ?").get(asset.id) as AssetRow;
  logAssetChange({
    action: "update",
    before: asset,
    after,
    extraChanges: {
      cash_flow_type: { from: null, to: "interest" },
      cash_flow_amount: { from: 0, to: signed },
      cash_flow_reason: { from: null, to: "利息收入" },
      interest_annual_rate: { from: null, to: annualRate },
      interest_principal: { from: null, to: principal }
    }
  });
  return after;
}

function creditInterest(asset: AssetRow, bucket: InterestBucket, interest: number, annualRate: number, principal: number) {
  const nextAmount = moneyCents((asset.amount ?? 0) + interest) / 100;
  const after = applyBalance(asset, nextAmount, interest, annualRate, principal);
  return { after, nextAmount, eventId: writeInterestEvent(after, bucket, interest, nextAmount, annualRate, principal) };
}

function applyBucket(bucket: InterestBucket, today: string): boolean {
  const db = getDB();
  const rate = readRate(bucket);
  const existing = readAccrual(today, bucket.id);
  const asset = findInterestAsset(bucket);
  if (!asset) throw new Error(`缺少利息账户：${bucket.label}`);

  if (!existing) {
    if (!(rate > 0)) return false;
    const principal = principalOf(bucket);
    const interest = dailyInterest(principal, rate);
    const posted = interest > 0 ? creditInterest(asset, bucket, interest, rate, principal) : null;
    db.prepare(
      `INSERT INTO interest_accrual
       (date, bucket, annual_rate, principal, interest, asset_id, event_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(today, bucket.id, rate, principal, interest, asset.id, posted?.eventId ?? null, nowCn());
    return interest > 0;
  }

  const tracked = db.prepare("SELECT id FROM asset WHERE id = ?").get(existing.asset_id) as { id: number } | undefined;
  if (existing.annual_rate === rate && tracked) return false;

  if (!tracked) {
    if (existing.event_id != null) db.prepare("DELETE FROM portfolio_event WHERE id = ?").run(existing.event_id);
    const principal = principalOf(bucket);
    const interest = dailyInterest(principal, rate);
    const posted = interest > 0 ? creditInterest(asset, bucket, interest, rate, principal) : null;
    db.prepare(
      `UPDATE interest_accrual
       SET annual_rate = ?, principal = ?, interest = ?, asset_id = ?, event_id = ?
       WHERE date = ? AND bucket = ?`
    ).run(rate, principal, interest, asset.id, posted?.eventId ?? null, today, bucket.id);
    return interest > 0;
  }

  const interest = dailyInterest(existing.principal, rate);
  const delta = (moneyCents(interest) - moneyCents(existing.interest)) / 100;
  let eventId = existing.event_id;
  if (delta !== 0) {
    const fresh = db.prepare("SELECT * FROM asset WHERE id = ?").get(asset.id) as AssetRow;
    const nextAmount = moneyCents((fresh.amount ?? 0) + delta) / 100;
    const after = applyBalance(fresh, nextAmount, delta, rate, existing.principal);
    if (interest > 0 && eventId != null) {
      db.prepare("UPDATE portfolio_event SET gross_amount = ?, metadata = ? WHERE id = ?").run(
        interest,
        JSON.stringify(interestMetadata(bucket, rate, existing.principal)),
        eventId
      );
      db.prepare("UPDATE portfolio_event_leg SET amount_delta = ?, amount_after = ? WHERE event_id = ?").run(
        interest,
        nextAmount,
        eventId
      );
    } else if (interest > 0) {
      eventId = writeInterestEvent(after, bucket, interest, nextAmount, rate, existing.principal);
    } else if (eventId != null) {
      db.prepare("DELETE FROM portfolio_event WHERE id = ?").run(eventId);
      eventId = null;
    }
  }
  db.prepare(
    "UPDATE interest_accrual SET annual_rate = ?, interest = ?, event_id = ? WHERE date = ? AND bucket = ?"
  ).run(rate, interest, eventId, today, bucket.id);
  return delta !== 0;
}

export function interestWorkPending(): boolean {
  if (INTEREST_BUCKETS.some((bucket) => !findInterestAsset(bucket))) return true;
  const today = todayCn();
  return INTEREST_BUCKETS.some((bucket) => {
    const rate = readRate(bucket);
    const row = readAccrual(today, bucket.id);
    if (!row) return rate > 0;
    return row.annual_rate !== rate;
  });
}

/** 确保四个利息账户存在，并按当日年化利率入账一次。无余额变化时不写快照。 */
export function accrueTodayInterest(): void {
  if (accruing || !interestWorkPending()) return;
  accruing = true;
  try {
    const db = getDB();
    const today = todayCn();
    db.transaction(() => {
      let changed = ensureInterestAccounts();
      for (const bucket of INTEREST_BUCKETS) changed = applyBucket(bucket, today) || changed;
      if (changed) recordSnapshot(getSetting("base_currency") ?? "CNY");
    })();
  } finally {
    accruing = false;
  }
}

export function saveInterestRates(rates: Record<InterestBucketId, number>) {
  for (const bucket of INTEREST_BUCKETS) {
    setSetting(bucket.settingKey, String(normalizeAnnualRate(rates[bucket.id])));
  }
  accrueTodayInterest();
}

export function getInterestStatus(): InterestBucketStatus[] {
  const today = todayCn();
  return INTEREST_BUCKETS.map((bucket) => {
    const annualRate = readRate(bucket);
    const accrual = readAccrual(today, bucket.id);
    const accrued = accrual != null && accrual.annual_rate === annualRate;
    const principal = accrued ? accrual.principal : principalOf(bucket);
    return {
      id: bucket.id,
      label: bucket.label,
      currency: bucket.currency,
      category: bucket.category,
      annualRate,
      principal,
      todayInterest: accrued ? accrual.interest : dailyInterest(principal, annualRate),
      accrued
    };
  });
}

export function interestBucketForAsset(assetId: number): InterestBucketId | null {
  for (const bucket of INTEREST_BUCKETS) {
    const asset = findInterestAsset(bucket);
    if (asset?.id === assetId) return bucket.id;
  }
  return null;
}
