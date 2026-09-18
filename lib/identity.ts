import type Database from "better-sqlite3";

/** 保留已有数字 ID；高水位永不随资产删除或恢复旧备份而回退。 */
export function syncEntitySequences(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_id_sequence (
      entity TEXT PRIMARY KEY CHECK (entity IN ('asset', 'account')),
      last_id INTEGER NOT NULL
    );
    INSERT INTO entity_id_sequence (entity, last_id)
      SELECT 'asset', COALESCE(MAX(id), 0) FROM (
        SELECT id FROM asset UNION ALL SELECT asset_id FROM asset_change
        UNION ALL SELECT asset_id FROM portfolio_event_leg
        UNION ALL SELECT asset_id FROM asset_valuation_daily
        UNION ALL SELECT asset_id FROM stock_price_daily
        UNION ALL SELECT asset_id FROM stock_refresh_log
      ) WHERE true
      ON CONFLICT(entity) DO UPDATE SET last_id = MAX(last_id, excluded.last_id);
    INSERT INTO entity_id_sequence (entity, last_id)
      SELECT 'account', COALESCE(MAX(id), 0) FROM (
        SELECT id FROM account UNION ALL SELECT account_id FROM asset
        UNION ALL SELECT account_id FROM asset_change
        UNION ALL SELECT account_id FROM portfolio_event_leg
        UNION ALL SELECT account_id FROM asset_valuation_daily
      ) WHERE true
      ON CONFLICT(entity) DO UPDATE SET last_id = MAX(last_id, excluded.last_id);
    CREATE TRIGGER IF NOT EXISTS asset_id_high_water AFTER INSERT ON asset BEGIN
      UPDATE entity_id_sequence SET last_id = MAX(last_id, NEW.id) WHERE entity = 'asset';
    END;
    CREATE TRIGGER IF NOT EXISTS account_id_high_water AFTER INSERT ON account BEGIN
      UPDATE entity_id_sequence SET last_id = MAX(last_id, NEW.id) WHERE entity = 'account';
    END;
  `);
}

export function allocateEntityId(db: Database.Database, entity: "asset" | "account"): number {
  if (!db.inTransaction) throw new Error("ID 分配必须与业务写入处于同一事务");
  const row = db.prepare(
    "UPDATE entity_id_sequence SET last_id = last_id + 1 WHERE entity = ? RETURNING last_id"
  ).get(entity) as { last_id: number } | undefined;
  if (!row || !Number.isSafeInteger(row.last_id)) throw new Error("无法分配资产身份");
  return row.last_id;
}
