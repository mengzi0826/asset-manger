import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// 运行时保险：确保进程时区为中国标准时间。next.config.mjs 已经设置过一次，
// 但脚本/工具单独加载 lib/db.ts 时仍可生效。
if (!process.env.TZ) {
  process.env.TZ = "Asia/Shanghai";
}

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "assets.db");

declare global {
  var __sqlite_db: Database.Database | undefined;
}

function initDB(): Database.Database {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "lib", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  migrateSchema(db);
  seedCategories(db);
  seedSettings(db);

  return db;
}

/** 对老库做幂等的字段补齐，避免删库重建 */
function migrateSchema(db: Database.Database) {
  // 汇率与逐资产估值历史：不从组合总额反推旧日明细，只精确回填当前 fx_rate 的已有观测点。
  db.exec(`
    CREATE TABLE IF NOT EXISTS fx_rate_history (
      base TEXT NOT NULL,
      quote TEXT NOT NULL,
      rate REAL NOT NULL,
      source TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      PRIMARY KEY (base, quote, observed_at)
    );
    CREATE INDEX IF NOT EXISTS idx_fx_rate_history_time
      ON fx_rate_history(observed_at DESC);
    INSERT OR IGNORE INTO fx_rate_history (base, quote, rate, source, observed_at)
      SELECT base, quote, rate, source, fetched_at
      FROM fx_rate
      WHERE rate > 0 AND fetched_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS asset_valuation_daily (
      date TEXT NOT NULL,
      base_currency TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      asset_name TEXT NOT NULL,
      category_code TEXT NOT NULL,
      currency TEXT NOT NULL,
      quantity REAL,
      unit_cost REAL,
      unit_price REAL,
      amount REAL,
      native_value REAL NOT NULL,
      fx_rate REAL,
      base_value REAL NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (date, base_currency, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_valuation_base_date
      ON asset_valuation_daily(base_currency, date ASC);
    CREATE INDEX IF NOT EXISTS idx_asset_valuation_asset
      ON asset_valuation_daily(asset_id, date ASC);
  `);
  // 统一事件层：旧库及 HMR 长连接都需幂等补表；资产引用故意不设外键，以保留已删除资产的历史。
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_event (
      id INTEGER PRIMARY KEY,
      event_type TEXT NOT NULL,
      currency TEXT NOT NULL,
      gross_amount REAL,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'user',
      metadata TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '+08:00')
    );
    CREATE INDEX IF NOT EXISTS idx_portfolio_event_time ON portfolio_event(occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_portfolio_event_type ON portfolio_event(event_type, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS portfolio_event_leg (
      id INTEGER PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES portfolio_event(id) ON DELETE CASCADE,
      asset_id INTEGER,
      account_id INTEGER,
      asset_name TEXT NOT NULL,
      role TEXT NOT NULL,
      amount_delta REAL,
      amount_after REAL,
      quantity_delta REAL,
      quantity_after REAL,
      unit_price REAL,
      unit_cost_after REAL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_portfolio_event_leg_event ON portfolio_event_leg(event_id, id);
    CREATE INDEX IF NOT EXISTS idx_portfolio_event_leg_asset ON portfolio_event_leg(asset_id, event_id DESC);
  `);
  // stock_price_daily：首次创建后从 stock_refresh_log 回填已有成功记录
  const spd = db.prepare("PRAGMA table_info(stock_price_daily)").all() as Array<{ name: string }>;
  if (spd.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_price_daily (
        asset_id INTEGER NOT NULL,
        date     TEXT    NOT NULL,
        price    REAL    NOT NULL,
        PRIMARY KEY (asset_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_price_daily_asset ON stock_price_daily(asset_id, date ASC);
      INSERT OR IGNORE INTO stock_price_daily (asset_id, date, price)
        SELECT asset_id,
               substr(created_at, 1, 10) AS date,
               price
        FROM (
          SELECT asset_id,
                 created_at,
                 price,
                 ROW_NUMBER() OVER (
                   PARTITION BY asset_id, substr(created_at, 1, 10)
                   ORDER BY id DESC
                 ) AS rn
          FROM stock_refresh_log
          WHERE ok = 1
            AND asset_id IS NOT NULL
            AND price IS NOT NULL
        )
        WHERE rn = 1;
    `);
  }
  const cols = db.prepare("PRAGMA table_info(asset)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("symbol")) {
    db.exec("ALTER TABLE asset ADD COLUMN symbol TEXT");
  }
  // 今日盈亏所需：每次股票价格刷新时同步落库的「单价涨跌额」「涨跌幅（小数，0.0013 表示 0.13%）」
  if (!names.has("change_amount")) {
    db.exec("ALTER TABLE asset ADD COLUMN change_amount REAL");
  }
  if (!names.has("change_percent")) {
    db.exec("ALTER TABLE asset ADD COLUMN change_percent REAL");
  }
  if (!names.has("change_updated_at")) {
    db.exec("ALTER TABLE asset ADD COLUMN change_updated_at TEXT");
  }
  if (!names.has("change_quote_date")) {
    db.exec("ALTER TABLE asset ADD COLUMN change_quote_date TEXT");
  }
}

function seedCategories(db: Database.Database) {
  // 幂等：缺失的分类自动补齐（支持给老库新增 liability 等）
  const rows: Array<{ code: string; name: string; sort: number }> = [
    { code: "cash", name: "现金", sort: 10 },
    { code: "deposit", name: "存款/理财", sort: 20 },
    { code: "fund", name: "基金", sort: 30 },
    { code: "securities", name: "证券/股票", sort: 40 },
    { code: "crypto", name: "加密货币", sort: 50 },
    { code: "liability", name: "负债", sort: 80 },
    { code: "other", name: "其他", sort: 99 }
  ];
  const stmt = db.prepare(
    "INSERT INTO category (code, name, sort_order) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING"
  );
  const insertAll = db.transaction((items: typeof rows) => {
    for (const r of items) stmt.run(r.code, r.name, r.sort);
  });
  insertAll(rows);
}

function seedSettings(db: Database.Database) {
  const row = db.prepare("SELECT value FROM setting WHERE key = 'base_currency'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO setting (key, value) VALUES (?, ?)").run("base_currency", "CNY");
  }
}

export function getDB(): Database.Database {
  if (!globalThis.__sqlite_db) {
    globalThis.__sqlite_db = initDB();
    return globalThis.__sqlite_db;
  }
  // 开发态/HMR 下进程可长期存活，代码更新后要确保新迁移也会补到旧连接上。
  migrateSchema(globalThis.__sqlite_db);
  return globalThis.__sqlite_db;
}

export type CategoryCode =
  | "cash"
  | "deposit"
  | "fund"
  | "securities"
  | "crypto"
  | "liability"
  | "other";

export interface Category {
  id: number;
  code: CategoryCode;
  name: string;
  sort_order: number;
}

export interface Account {
  id: number;
  category_id: number;
  name: string;
  institution: string | null;
  notes: string | null;
  created_at: string;
}

export interface AssetRow {
  id: number;
  account_id: number;
  name: string;
  symbol: string | null;
  currency: string;
  quantity: number;
  unit_cost: number | null;
  current_price: number | null;
  /** 当日单价涨跌额（原币），来自最近一次股票行情刷新 */
  change_amount: number | null;
  /** 当日涨跌幅（小数，0.0013 = 0.13%） */
  change_percent: number | null;
  /** 历史兼容字段：早期用它判定"今日"；现逻辑改为以 change_quote_date 为准 */
  change_updated_at: string | null;
  /** 接口会话日 YYYY-MM-DD；仅等于 todayCn() 时计入今日盈亏。解析失败则为 null */
  change_quote_date: string | null;
  amount: number | null;
  annual_rate: number | null;
  start_date: string | null;
  maturity_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetWithMeta extends AssetRow {
  account_name: string;
  category_id: number;
  category_code: CategoryCode;
  category_name: string;
}

export interface AssetChange {
  id: number;
  asset_id: number | null;
  account_id: number | null;
  asset_name: string | null;
  action: "create" | "update" | "delete";
  field_changes: string | null;
  snapshot: string | null;
  base_value_cny: number | null;
  created_at: string;
}

export interface PortfolioSnapshot {
  id: number;
  date: string;
  base_currency: string;
  total_value: number;
  breakdown: string | null;
  created_at: string;
}

export interface FxRate {
  base: string;
  quote: string;
  rate: number;
  source: string;
  fetched_at: string;
}

export interface FxRateHistory {
  base: string;
  quote: string;
  rate: number;
  source: string;
  observed_at: string;
}

export interface AssetValuationDaily {
  date: string;
  base_currency: string;
  asset_id: number;
  account_id: number;
  asset_name: string;
  category_code: CategoryCode;
  currency: string;
  quantity: number | null;
  unit_cost: number | null;
  unit_price: number | null;
  amount: number | null;
  native_value: number;
  fx_rate: number | null;
  base_value: number;
  captured_at: string;
}

/** 最近一次汇率自动拉取失败原因；成功则删除 */
export const SETTING_LAST_FX_REFRESH_ERROR = "last_fx_refresh_error";
/** 最近一次股票拉取失败原因（整批无一成功）；成功则删除 */
export const SETTING_LAST_STOCKS_REFRESH_ERROR = "last_stocks_refresh_error";

export function getSetting(key: string): string | null {
  const db = getDB();
  const row = db.prepare("SELECT value FROM setting WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  const db = getDB();
  db.prepare(
    "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function removeSetting(key: string) {
  getDB().prepare("DELETE FROM setting WHERE key = ?").run(key);
}
