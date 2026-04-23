PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS category (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS account (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  institution TEXT,
  notes TEXT,
  -- 默认写入中国时区（UTC+8）的 ISO 时间戳
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '+08:00')
);

CREATE TABLE IF NOT EXISTS asset (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT,                         -- 股票/基金代码：A 股 600519 / 港股 00700 / 美股 AAPL
  currency TEXT NOT NULL DEFAULT 'CNY',
  quantity REAL NOT NULL DEFAULT 1,
  unit_cost REAL,
  current_price REAL,
  amount REAL,
  annual_rate REAL,
  start_date TEXT,
  maturity_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '+08:00'),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '+08:00')
);

CREATE INDEX IF NOT EXISTS idx_asset_account ON asset(account_id);

CREATE TABLE IF NOT EXISTS fx_rate (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'frankfurter',
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (base, quote)
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 单笔资产的逐条变动日志
CREATE TABLE IF NOT EXISTS asset_change (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER,                  -- 可空，因为资产可能被删除
  account_id INTEGER,
  asset_name TEXT,
  action TEXT NOT NULL,              -- create / update / delete
  field_changes TEXT,                -- JSON: {field: {from, to}}
  snapshot TEXT,                     -- JSON: 变动后的完整资产快照
  base_value_cny REAL,               -- 变动后该资产按CNY估值（便于排序/展示）
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '+08:00')
);

CREATE INDEX IF NOT EXISTS idx_asset_change_time ON asset_change(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_change_asset ON asset_change(asset_id);

-- 每日总资产快照（幂等：同一天同一货币只保留一条）
CREATE TABLE IF NOT EXISTS portfolio_snapshot (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                -- YYYY-MM-DD
  base_currency TEXT NOT NULL,       -- CNY / USD
  total_value REAL NOT NULL,
  breakdown TEXT,                    -- JSON: {cash:x, deposit:y, ...}
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '+08:00'),
  UNIQUE(date, base_currency)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_date ON portfolio_snapshot(date);
