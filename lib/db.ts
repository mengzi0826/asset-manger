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
  const cols = db.prepare("PRAGMA table_info(asset)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("symbol")) {
    db.exec("ALTER TABLE asset ADD COLUMN symbol TEXT");
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
  }
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
