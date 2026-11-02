// Deterministic date/holdings fixtures. Never opens the user's SQLite database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Module } = require("node:module");

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
let now;
let deleted;
let quantityEdits;
let missingFx;
const db = {
  prepare(sql) {
    if (sql.includes("action = 'delete'")) {
      return { all: (day) => deleted.filter((row) => row.created_at.startsWith(day)) };
    }
    if (sql.includes("action = 'update'")) {
      return { all: (...args) => quantityEdits.filter((row) =>
        args.slice(0, -1).includes(row.asset_id) && row.created_at.startsWith(args.at(-1))) };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};
const { computeTodayStockPnL } = load("../lib/history.ts", {
  "./db": { getDB: () => db },
  "./fx": { convert: (value, from, to) => {
    if (from === to) return value;
    if (missingFx || to !== "CNY") return null;
    return value * ({ USD: 7, HKD: 0.9 }[from] ?? NaN);
  } },
  "./valuation": {},
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
  deleted = [];
  quantityEdits = [];
  missingFx = false;
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
  missingFx = true;
  const result = calculate();
  assert.equal(result.availableTotalBase, null);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.missingRates, ["USD->CNY"]);
});

test("same-day reductions still use the quantity before the first edit", () => {
  quantityEdits = [{ asset_id: 1, created_at: now,
    field_changes: JSON.stringify({ quantity: { from: 5, to: 2 } }) }];
  money(calculate().availableTotalBase, 350);
});

test("deleted holdings obey the same US expiration rule", () => {
  const removed = { id: 9, name: "US fixture", symbol: "AAPL", category_code: "securities",
    currency: "USD", quantity: 2, current_price: 110, change_percent: 0.1, change_quote_date: "2026-10-30" };
  deleted = [{ asset_id: 9, created_at: now, snapshot: JSON.stringify(removed) }];
  assert.equal(calculate([]).closedPositions.length, 1);
  money(calculate([]).availableTotalBase, 140);
  now = "2026-11-02T10:00:00+08:00";
  deleted[0].created_at = now;
  const result = calculate([]);
  unavailable(result);
  assert.equal(result.closedPositions.length, 0);
});

console.log(`\n${checks} checks passed`);
