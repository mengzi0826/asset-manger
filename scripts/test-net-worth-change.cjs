// Pure attribution fixtures: never opens or writes the user's SQLite database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Module } = require("node:module");
const filename = path.resolve(__dirname, "../lib/netWorthChange.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const fixtureModule = new Module(filename, module);
fixtureModule._compile(compiled, filename);
const { calculateNetWorthChange } = fixtureModule.exports;
const from = "2026-09-17", to = "2026-09-18";
const at = date => `${date}T20:00:00+08:00`;
const row = (id, category, native, extra = {}) => ({
  asset_id: id, category_code: category, currency: "CNY", native_value: native,
  base_value: native, fx_rate: 1, quantity: null, unit_price: null, unit_cost: null, amount: native, ...extra
});
const stock = (id, qty, price, extra = {}) => row(id, "securities", qty * price, {
  amount: null, quantity: qty, unit_price: price, unit_cost: 8, ...extra
});
const sum = rows => rows.reduce((n, r) => n + r.base_value * (r.category_code === "liability" ? -1 : 1), 0);
const snap = (date, value) => ({ date, total_value: value, base_currency: "CNY", created_at: at(date) });
const event = (type, legs, extra = {}) => ({ id: 1, type, currency: "CNY", occurredAt: at(to), legs, ...extra });
const leg = (id, role, amount, quantity, price) => ({ assetId: id, role, amountDelta: amount, quantityDelta: quantity, unitPrice: price });
function calculate(left, right, events = [], extra = {}) {
  const result = calculateNetWorthChange({ previous: snap(from, sum(left)), current: snap(to, sum(right)),
    previousAssets: left, currentAssets: right, events, reliableFrom: at("2026-09-01"), ...extra });
  assert.equal(Math.round(result.items.reduce((n, item) => n + item.amount, 0) * 100), Math.round(result.total * 100), "detail sum reconciles");
  return result;
}
const amount = (result, kind) => result.items.find(item => item.kind === kind)?.amount ?? 0;
let checks = 0;
function test(name, work) { work(); checks++; console.log(`✓ ${name}`); }

test("cash deposits and expenses are independent of investment return", () => {
  const r = calculate([row(1, "cash", 1000)], [row(1, "cash", 1120)], [
    event("cash_deposit", [leg(1, "cash", 150)]), event("cash_expense", [leg(1, "cash", -30)], { id: 2 })
  ]);
  assert.equal(amount(r, "deposit"), 150); assert.equal(amount(r, "expense"), -30); assert.equal(r.partial, false);
});
test("linked buy only contributes price movement", () => {
  const r = calculate([row(1, "cash", 1000), stock(2, 10, 10)], [row(1, "cash", 940), stock(2, 15, 13)],
    [event("security_buy", [leg(2, "security", null, 5, 12), leg(1, "cash", -60)])]);
  assert.equal(amount(r, "securities"), 35); assert.equal(amount(r, "unlinked_trade"), 0);
});
test("liquidation includes proceeds and sold position gain", () => {
  const r = calculate([row(1, "cash", 1000), stock(2, 10, 10)], [row(1, "cash", 1120)],
    [event("security_liquidation", [leg(2, "security", null, -10, 12), leg(1, "cash", 120)])]);
  assert.equal(amount(r, "securities"), 20); assert.equal(amount(r, "unclassified"), 0);
});
test("intraday buy and liquidation without either endpoint position", () => {
  const r = calculate([row(1, "cash", 1000)], [row(1, "cash", 1020)], [
    event("security_buy", [leg(2, "security", null, 10, 10), leg(1, "cash", -100)]),
    event("security_liquidation", [leg(2, "security", null, -10, 12), leg(1, "cash", 120)], { id: 2 })
  ]);
  assert.equal(amount(r, "securities"), 20); assert.equal(amount(r, "unclassified"), 0);
});
test("unlinked sell principal is not a loss", () => {
  const r = calculate([stock(2, 10, 10)], [stock(2, 5, 12)],
    [event("security_sell", [leg(2, "security", null, -5, 11)])]);
  assert.equal(amount(r, "securities"), 15); assert.equal(amount(r, "unlinked_trade"), -55);
});
test("dividend and ex-dividend price move reconcile without cost double counting", () => {
  const r = calculate([row(1, "cash", 100), stock(2, 10, 10)], [row(1, "cash", 110), stock(2, 10, 9, { unit_cost: 7 })],
    [event("security_dividend", [leg(2, "security"), leg(1, "cash", 10)])]);
  assert.equal(amount(r, "dividend"), 10); assert.equal(amount(r, "securities"), -10); assert.equal(r.total, 0);
});
test("FX uses symmetric exposure and carries the liability sign", () => {
  const foreign = (rate, debt) => row(1, debt ? "liability" : "cash", 100, { currency: "USD", fx_rate: rate, base_value: rate * 100 });
  assert.equal(amount(calculate([foreign(7, false)], [foreign(7.2, false)]), "fx"), 20);
  assert.equal(amount(calculate([foreign(7, true)], [foreign(7.2, true)]), "fx"), -20);
});
test("foreign deposit and FX are not counted twice", () => {
  const a = row(1, "cash", 100, { currency: "USD", fx_rate: 7, base_value: 700 });
  const b = row(1, "cash", 110, { currency: "USD", fx_rate: 7.2, base_value: 792 });
  const r = calculate([a], [b], [event("cash_deposit", [leg(1, "cash", 10)], { currency: "USD" })]);
  assert.equal(amount(r, "deposit"), 71); assert.equal(amount(r, "fx"), 21);
});
test("liability reduction increases net worth", () => {
  const r = calculate([row(1, "liability", 100)], [row(1, "liability", 80)]);
  assert.equal(amount(r, "liability"), 20);
});
test("manual price calibration is not stock return", () => {
  const r = calculate([stock(2, 10, 10)], [stock(2, 10, 12)], [event("manual_adjustment", [leg(2, "security")], {
    metadata: { native_value_before: 100, native_value_after: 120, category_before: "securities", category_after: "securities", currency_before: "CNY", currency_after: "CNY" }
  })]);
  assert.equal(amount(r, "adjustment"), 20); assert.equal(amount(r, "securities"), 0);
});
test("unknown manual changes and unmatched quantities remain unclassified", () => {
  const left = [stock(2, 10, 10)], right = [stock(2, 20, 11)];
  assert.equal(amount(calculate(left, right), "unclassified"), 120);
  const r = calculate(left, right, [event("manual_adjustment", [leg(2, "security")])]);
  assert.equal(amount(r, "securities"), 0); assert.equal(amount(r, "unclassified"), 120);
});
test("old total-only snapshots never infer historical attribution", () => {
  const r = calculate([], [], [], { previous: snap(from, 1000), current: snap(to, 1025), reliableFrom: null });
  assert.equal(amount(r, "unclassified"), 25); assert.equal(r.partial, true);
});
test("missing rates and new currencies never use today's rates", () => {
  const r = calculate([row(1, "cash", 100)], [row(1, "cash", 100), row(2, "cash", 20, { currency: "USD", fx_rate: 7, base_value: 140 })]);
  assert.equal(amount(r, "unclassified"), 140); assert.equal(amount(r, "fx"), 0);
});
test("pre-coverage securities delta does not claim investment return", () => {
  const r = calculate([stock(2, 10, 10)], [stock(2, 10, 12)], [], { reliableFrom: at(to) });
  assert.equal(amount(r, "securities"), 0); assert.equal(amount(r, "unclassified"), 20);
});
test("asset creation and removal stay distinct from deposits and expenses", () => {
  const r = calculate([row(1, "cash", 100), row(3, "deposit", 50)], [row(1, "cash", 100), row(2, "deposit", 80)], [
    event("asset_created", [leg(2, "asset", 80)], { grossAmount: 80, metadata: { category_code: "deposit" } }),
    event("asset_deleted", [leg(3, "asset", -50)], { id: 2, grossAmount: 50, metadata: { category_code: "deposit" } })
  ]);
  assert.equal(amount(r, "created"), 80); assert.equal(amount(r, "deleted"), -50);
});
test("missing yesterday uses the actual previous date", () => {
  const r = calculate([row(1, "cash", 100)], [row(1, "cash", 100)], [], { previous: snap("2026-09-15", 100) });
  assert.equal(r.comparison, "较上次快照（2026-09-15）");
});
test("first snapshot has no fabricated zero change", () => {
  const r = calculateNetWorthChange({ current: snap(to, 100), previousAssets: [], currentAssets: [], events: [], reliableFrom: null });
  assert.equal(r.total, null); assert.equal(r.percent, null);
});
test("displayed cents reconcile with negative baseline and rounding", () => {
  const r = calculate([row(1, "liability", 100.004)], [row(1, "liability", 99.999)]);
  assert.equal(r.total, 0); assert.ok(r.percent > 0);
});
test("all events included, including more than the normal list cap", () => {
  const events = Array.from({ length: 5001 }, (_, id) => event("cash_deposit", [leg(1, "cash", 1)], { id }));
  const r = calculate([row(1, "cash", 100)], [row(1, "cash", 5101)], events);
  assert.equal(amount(r, "deposit"), 5001);
});
test("events after the endpoint capture time are excluded", () => {
  const r = calculate([row(1, "cash", 100)], [row(1, "cash", 100)], [
    event("cash_deposit", [leg(1, "cash", 50)], { occurredAt: `${to}T21:00:00+08:00` })
  ]);
  assert.equal(amount(r, "deposit"), 0);
});
test("cost-only revaluation after a trade is not claimed as market gain", () => {
  const r = calculate([row(1, "cash", 1000), stock(2, 10, 10, { unit_cost: 10 })],
    [row(1, "cash", 940), stock(2, 15, 11, { unit_cost: 11 })],
    [event("security_buy", [{ ...leg(2, "security", null, 5, 12), unitCostAfter: 11 }, leg(1, "cash", -60)])]);
  assert.equal(amount(r, "securities"), 0); assert.equal(amount(r, "unclassified"), 5);
});
test("legacy zero opening value with nonzero position is not fabricated profit", () => {
  const r = calculate([row(1, "cash", 1000)], [row(1, "cash", 1000), stock(2, 10, 10)],
    [event("asset_created", [leg(2, "security", null, 10, 10)], { grossAmount: 0, metadata: { category_code: "securities" } })]);
  assert.equal(amount(r, "securities"), 0); assert.equal(amount(r, "unclassified"), 100);
});
test("classification changes from asset to debt remain manual calibration", () => {
  const r = calculate([row(1, "cash", 100)], [row(1, "liability", 100)], [event("manual_adjustment", [leg(1, "asset")], {
    metadata: { native_value_before: 100, native_value_after: 100, category_before: "cash", category_after: "liability", currency_before: "CNY", currency_after: "CNY" }
  })]);
  assert.equal(amount(r, "adjustment"), -200); assert.equal(amount(r, "unclassified"), 0);
});

test("batch history reads every event and retains the off-chart baseline", () => {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.resolve(__dirname, "../lib/schema.sql"), "utf8"));
  db.prepare("INSERT INTO history_integrity(id,reliable_from) VALUES(1,?)").run(at("2026-09-01"));
  for (const [date, amount] of [[from, 100], [to, 5101]]) {
    db.prepare("INSERT INTO portfolio_snapshot(date,base_currency,total_value,created_at) VALUES(?,'CNY',?,?)").run(date, amount, at(date));
    db.prepare(`INSERT INTO asset_valuation_daily(date,base_currency,asset_id,account_id,asset_name,category_code,currency,amount,native_value,fx_rate,base_value,captured_at)
      VALUES(?,'CNY',1,1,'fixture','cash','CNY',?,?,1,?,?)`).run(date, amount, amount, amount, at(date));
  }
  const insert = db.prepare("INSERT INTO portfolio_event(id,event_type,currency,gross_amount,occurred_at,created_at) VALUES(?,'cash_deposit','CNY',1,?,?)");
  const insertLeg = db.prepare("INSERT INTO portfolio_event_leg(event_id,asset_id,asset_name,role,amount_delta) VALUES(?,1,'fixture','cash',1)");
  db.transaction(() => { for (let i = 1; i <= 5001; i++) { insert.run(i, at(to), at(to)); insertLeg.run(i); } })();
  const stubs = {
    "./db": { getDB: () => db },
    "./fx": { getRate: () => 1, getHistoricalRateAtOrBefore: () => 1 },
    "./time": { nowCn: () => at(to), todayCn: () => to },
    "./netWorthChange": { calculateNetWorthChange }
  };
  const load = name => {
    const file = path.resolve(__dirname, `../lib/${name}.ts`);
    const compiledModule = new Module(file, module);
    compiledModule.require = id => stubs[id] ?? require(id);
    compiledModule._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, file);
    return compiledModule.exports;
  };
  stubs["./portfolioEvents"] = load("portfolioEvents");
  const { listPortfolioEvents } = stubs["./portfolioEvents"];
  assert.equal(listPortfolioEvents().length, 500);
  assert.equal(listPortfolioEvents({ limit: null }).length, 5001);
  assert.equal(listPortfolioEvents({ limit: 1 })[0].legs.length, 1);
  const { buildNetWorthHistory } = load("netWorthHistory");
  const history = buildNetWorthHistory(db.prepare("SELECT * FROM portfolio_snapshot WHERE date = ?").all(to));
  assert.equal(history.length, 1);
  assert.equal(history[0].change.from, from);
  assert.equal(amount(history[0].change, "deposit"), 5001);
  assert.equal(history[0].change.partial, false);
  db.close();
});
console.log(`${checks} attribution checks passed.`);
