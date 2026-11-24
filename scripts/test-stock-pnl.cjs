// Deterministic date/holdings fixtures. Never opens the user's SQLite database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Module } = require("node:module");
const Database = require("better-sqlite3");

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const fixture = new Module(filename, module);
  fixture.require = (id) => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  };
  fixture._compile(compiled, filename);
  return fixture.exports;
}

const time = load("../lib/time.ts");
const db = new Database(":memory:");
db.exec(fs.readFileSync(path.join(__dirname, "../lib/schema.sql"), "utf8"));
const database = { getDB: () => db };
const fx = load("../lib/fx.ts", {
  "./db": database,
  "./time": time,
  "./currencies": load("../lib/currencies.ts"),
  "./juheKeys": {},
  undici: {}
});
const valuation = load("../lib/valuation.ts", { "./db": database, "./fx": fx });
const insertChange = db.prepare(`INSERT INTO asset_change (asset_id, action, created_at, field_changes, snapshot)
  VALUES (@asset_id, @action, @created_at, @field_changes, @snapshot)`);
const addChange = row => insertChange.run({ action: "update", field_changes: null, snapshot: null, ...row });
const setRate = db.prepare("INSERT INTO fx_rate (base, quote, rate, fetched_at) VALUES (?, ?, ?, ?)");
let now;
const { computeTodayStockPnL, listStockPriceHistory } = load("../lib/history.ts", {
  "./db": database,
  "./fx": fx,
  "./valuation": valuation,
  "./changeLog": { CHANGE_LOG_PAGE_SIZE: 20 },
  "./historicalFxImpact": load("../lib/historicalFxImpact.ts"),
  "./time": { ...time, todayCn: () => time.toCnIso(new Date(now)).slice(0, 10) },
  "./stocks": { parseStockSymbol: () => ({ market: "us" }) }
});

const stock = (id, market, date, extra = {}) => ({
  id, market, changeQuoteDate: date, currency: { hs: "CNY", hk: "HKD", us: "USD" }[market],
  quantity: 2, currentPrice: 110, changePercent: 0.1, ...extra
});
const friday = stock(1, "us", "2026-10-30");
const calculate = (items = [friday]) => computeTodayStockPnL(items, "CNY");
const money = (actual, expected) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
};
const unavailable = (result) => {
  assert.equal(result.availableTotalBase, null);
  assert.equal(result.status, "unavailable");
  assert.equal(result.perAsset.size, 0);
  assert.equal(result.sessionDates.us, null);
};
let checks = 0;
function test(name, work) {
  now = "2026-10-31T12:00:00+08:00";
  db.exec("DELETE FROM asset_change; DELETE FROM fx_rate;");
  setRate.run("USD", "CNY", 7, now);
  setRate.run("HKD", "CNY", 0.9, now);
  work();
  checks++;
  console.log(`✓ ${name}`);
}

test("Friday US quotes remain visible through Beijing Saturday", () => {
  for (const instant of ["2026-10-30T22:00:00+08:00", "2026-10-31T02:00:00+08:00", "2026-10-31T23:59:59+08:00"]) {
    now = instant;
    const result = calculate();
    assert.equal(result.sessionDates.us, "2026-10-30");
    money(result.availableTotalBase, 140);
    assert.equal(result.status, "complete");
  }
});

test("Friday US quotes expire exactly at Beijing Sunday midnight", () => {
  now = "2026-11-01T00:00:00+08:00";
  unavailable(calculate());
});

test("Sunday has no daily PnL from any of the three markets", () => {
  now = "2026-11-01T12:00:00+08:00";
  unavailable(calculate([friday, stock(2, "hs", "2026-10-30"), stock(3, "hk", "2026-10-30")]));
});

test("Monday never carries Friday US PnL, before or after US open", () => {
  for (const instant of ["2026-11-02T10:00:00+08:00", "2026-11-02T23:00:00+08:00"]) {
    now = instant;
    unavailable(calculate());
  }
});

test("Monday China/HK PnL excludes stale US holdings", () => {
  now = "2026-11-02T10:00:00+08:00";
  const result = calculate([friday, stock(2, "hs", "2026-11-02"), stock(3, "hk", "2026-11-02")]);
  money(result.availableTotalBase, 38);
  assert.deepEqual([...result.perAsset.keys()], [2, 3]);
  assert.equal(result.sessionDates.us, null);
  assert.equal(result.status, "partial");
});

test("new Monday US quotes resume daily PnL and survive Tuesday", () => {
  for (const instant of ["2026-11-02T23:00:00+08:00", "2026-11-03T12:00:00+08:00"]) {
    now = instant;
    const result = calculate([stock(1, "us", "2026-11-02")]);
    money(result.availableTotalBase, 140);
    assert.equal(result.sessionDates.us, "2026-11-02");
  }
});

test("only the newest US session in the display window contributes", () => {
  now = "2026-11-03T23:00:00+08:00";
  const result = calculate([stock(1, "us", "2026-11-02"), stock(2, "us", "2026-11-03")]);
  assert.equal(result.sessionDates.us, "2026-11-03");
  assert.deepEqual([...result.perAsset.keys()], [2]);
  money(result.availableTotalBase, 140);
});

test("null and future quote dates never contribute", () => {
  unavailable(calculate([stock(1, "us", null), stock(2, "us", "2026-11-02")]));
});

test("valid zero PnL is distinct from expired quotes", () => {
  const result = calculate([stock(1, "us", "2026-10-30", { changePercent: 0 })]);
  assert.equal(result.availableTotalBase, 0);
  assert.equal(result.status, "complete");
});

test("missing FX remains unavailable rather than zero", () => {
  db.exec("DELETE FROM fx_rate");
  const result = calculate();
  assert.equal(result.availableTotalBase, null);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.missingRates, ["USD->CNY"]);
});

test("same-day reductions still use the quantity before the first edit", () => {
  addChange({ asset_id: 1, created_at: now,
    field_changes: JSON.stringify({ quantity: { from: 5, to: 2 } }) });
  money(calculate().availableTotalBase, 350);
});

test("deleted holdings obey the same US expiration rule", () => {
  const removed = { id: 9, name: "US fixture", symbol: "AAPL", category_code: "securities",
    currency: "USD", quantity: 2, current_price: 110, change_percent: 0.1, change_quote_date: "2026-10-30" };
  addChange({ asset_id: 9, action: "delete", created_at: now, snapshot: JSON.stringify(removed) });
  assert.equal(calculate([]).closedPositions.length, 1);
  money(calculate([]).availableTotalBase, 140);
  now = "2026-11-02T10:00:00+08:00";
  db.prepare("UPDATE asset_change SET created_at = ?").run(now);
  const result = calculate([]);
  unavailable(result);
  assert.equal(result.closedPositions.length, 0);
});

test("quantity changes and deletions use Beijing midnight across legacy formats", () => {
  const removed = { id: 9, name: "US fixture", symbol: "AAPL", category_code: "securities",
    currency: "USD", quantity: 2, current_price: 110, change_percent: 0.1, change_quote_date: "2026-10-30" };
  const edit = (at, from, to) => addChange({ asset_id: 1, created_at: at,
    field_changes: JSON.stringify({ quantity: { from, to } }) });
  edit("2026-10-30 15:59:59", 20, 5); // 前一北京日
  edit("2026-10-30T16:01:00Z", 4, 2);
  edit("2026-10-30 16:00:00", 5, 4); // 北京当天第一笔；ID 大于下一条
  edit("2026-10-31T16:00:00Z", 2, 1); // 下一北京日
  addChange({ asset_id: 1, created_at: "2026-10-31T00:00:00+08:00", field_changes: "broken" });
  addChange({ asset_id: 9, action: "delete", created_at: "2026-10-30T16:15:00", snapshot: JSON.stringify(removed) });
  const result = calculate();
  money(result.perAsset.get(1).todayPnLBase, 350);
  money(result.perAsset.get(9).todayPnLBase, 140);
});

test("manual price history groups and orders actual Beijing timestamps", () => {
  const edit = (at, value) => addChange({ asset_id: 1, created_at: at,
    field_changes: JSON.stringify({ current_price: { to: value } }) });
  edit("2026-10-30 15:59:59", 100);
  edit("2026-10-31T01:00:00+08:00", 106);
  edit("2026-10-30T16:00:00Z", 103);
  edit("2026-10-30 17:00:00", 107); // 同一时刻取较大 ID
  edit("2026-10-31T16:00:00Z", 108);
  db.prepare("INSERT INTO stock_price_daily (asset_id, date, price) VALUES (1, '2026-11-01', 110)").run();
  assert.deepEqual(listStockPriceHistory([1]).get(1), [
    { date: "2026-10-30", price: 100 }, { date: "2026-10-31", price: 107 }, { date: "2026-11-01", price: 110 }
  ]);
});

test("a zero-valued foreign position uses the real FX rate for floating loss", () => {
  db.exec(`INSERT INTO category (id, code, name) VALUES (1, 'securities', 'Test');
    INSERT INTO account (id, category_id, name) VALUES (1, 1, 'Test');
    INSERT INTO asset (account_id, name, currency, quantity, unit_cost, current_price)
    VALUES (1, 'USD', 'USD', 1, 100, 0), (1, 'Missing FX', 'HKD', 1, 100, 0);`);
  db.exec("DELETE FROM fx_rate");
  setRate.run("CNY", "USD", 1 / 7, now);
  const { items } = valuation.valueAll("CNY");
  const usd = items.find(item => item.currency === "USD");
  assert.equal(usd.native_value, 0);
  assert.equal(usd.profit_native, -100);
  money(usd.profit_base, -700);
  assert.equal(usd.profit_rate, -1);
  assert.equal(items.find(item => item.currency === "HKD").profit_base, null);
  assert.deepEqual(valuation.summarizeFloatingProfit(items), { total: null, knownSubtotal: -700, status: "partial" });
  db.exec("DELETE FROM fx_rate");
  assert.deepEqual(valuation.summarizeFloatingProfit(valuation.valueAll("CNY").items),
    { total: null, knownSubtotal: null, status: "unavailable" });
});

db.close();
console.log(`\n${checks} checks passed`);
