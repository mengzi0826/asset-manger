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
  change_amount REAL,                  -- 当日单价涨跌额（原币），来自股票行情接口
  change_percent REAL,                 -- 当日涨跌幅（小数：0.0013 = 0.13%）
  change_updated_at TEXT,              -- 历史兼容字段（当前"今日"判定已改用 change_quote_date）
  change_quote_date TEXT,             -- 接口会话日 YYYY-MM-DD；空则不计入「今日」
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

-- 汇率观测历史：同一币对每个整点保留最终生效值，用于拆分汇兑影响
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

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 数字身份高水位独立于业务表保存，删除/恢复不会使新资产复用旧身份。
CREATE TABLE IF NOT EXISTS entity_id_sequence (
  entity TEXT PRIMARY KEY CHECK (entity IN ('asset', 'account')),
  last_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS history_integrity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reliable_from TEXT NOT NULL,
  last_import_at TEXT
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

-- 统一资产事件：一条事件头对应多条资产腿，用于把证券与现金的联动操作关联起来
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

-- 每日逐资产估值：固化原币价值、当时汇率和基准币价值，供收益归因与 AI 只读分析
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

-- 股票价格接口调用日志（每次单股请求一条，便于排查未刷新原因）
CREATE TABLE IF NOT EXISTS stock_refresh_log (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  asset_id INTEGER,
  asset_name TEXT,
  symbol TEXT,
  api_param TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  price REAL,
  error TEXT,
  force_refresh INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '+08:00')
);

CREATE INDEX IF NOT EXISTS idx_stock_refresh_log_time ON stock_refresh_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_refresh_log_symbol ON stock_refresh_log(symbol, created_at DESC);

-- 每日股票收盘价快照（每只股票每天一条，永久保留，用于浮动盈亏走势图）
CREATE TABLE IF NOT EXISTS stock_price_daily (
  asset_id INTEGER NOT NULL,
  date     TEXT    NOT NULL,   -- YYYY-MM-DD（北京日期）
  price    REAL    NOT NULL,
  PRIMARY KEY (asset_id, date)
);

CREATE INDEX IF NOT EXISTS idx_stock_price_daily_asset ON stock_price_daily(asset_id, date ASC);
