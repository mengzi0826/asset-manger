// Route-level checks against an in-memory SQLite database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Module } = require("node:module");
const ts = require("typescript");
const db = new (require("better-sqlite3"))(":memory:");
const root = path.resolve(__dirname, "..");
db.exec(fs.readFileSync(path.join(root, "lib/schema.sql"), "utf8"));
db.exec(`INSERT INTO category(id,code,name) VALUES (1,'cash','现金');
  INSERT INTO account(id,category_id,name) VALUES (1,1,'测试');
  INSERT INTO asset(id,account_id,name,amount) VALUES (1,1,'钱包',100);`);
const modules = new Map([["lib/db", { getDB: () => db, getSetting: () => "CNY" }]]);
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const filename = path.join(root, name + ".ts");
  const compiled = new Module(filename);
  modules.set(name, compiled.exports);
  compiled.require = id => {
    if (id.startsWith("@/")) return load(id.slice(2));
    if (id.startsWith(".")) return load(path.join(path.dirname(name), id));
    return require(id);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return compiled.exports;
}

const route = load("app/api/assets/[id]/cash-flow/route");
const { lastManualCashFlow } = load("lib/cashFlowUndo");
const { listCashFlowEntries } = load("lib/history");
const { summarizeCashFlow } = load("lib/portfolioEvents");
const balance = () => db.prepare("SELECT amount FROM asset WHERE id=1").get().amount;
const call = (method, body) => route[method]({ json: async () => body }, { params: { id: "1" } });
async function run() {
  assert.equal((await call("POST", { type: "deposit", amount: 40, reason: "工资" })).status, 200);
  const previous = lastManualCashFlow(1);
  assert.equal((await call("POST", { type: "expense", amount: 8, reason: "午餐" })).status, 200);
  assert.equal((await call("DELETE", previous)).status, 409);
  const target = lastManualCashFlow(1);
  // Simulate an earlier submission made before explicit change IDs existed.
  const earlier = "2026-01-10T12:00:00+08:00";
  db.prepare("UPDATE portfolio_event SET occurred_at=?, metadata=NULL WHERE id=?").run(earlier, target.eventId);
  db.prepare("UPDATE asset_change SET created_at=? WHERE id=?").run(earlier, target.changeId);
  db.exec("UPDATE asset SET amount=amount+3 WHERE id=1");
  assert.equal(lastManualCashFlow(1).changeId, target.changeId);
  db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON portfolio_snapshot BEGIN SELECT RAISE(ABORT,'snapshot'); END;");
  assert.equal((await call("DELETE", target)).status, 409);
  assert.equal(balance(), 135);
  assert.equal(listCashFlowEntries(1).length, 2);
  db.exec("DROP TRIGGER fail_snapshot");
  assert.equal((await call("DELETE", target)).status, 200);
  assert.equal(balance(), 143);
  assert.equal(lastManualCashFlow(1), null);
  assert.equal((await call("DELETE", target)).status, 409);
  assert.deepEqual(listCashFlowEntries(1).map(row => row.reason), ["工资"]);
  const summary = summarizeCashFlow("2000-01-01", "2099-12-31", "cash_expense", "CNY");
  assert.equal(summary.count, 0);
  assert.equal(summary.approximateBaseValue, 0);
  assert.equal(db.prepare("SELECT total_value FROM portfolio_snapshot ORDER BY date DESC LIMIT 1").get().total_value, 143);
  assert.equal((await call("POST", { type: "deposit", amount: 30, reason: "转入" })).status, 200);
  const deposit = lastManualCashFlow(1);
  db.exec("UPDATE asset SET amount=12 WHERE id=1");
  assert.equal((await call("DELETE", deposit)).status, 409);
  assert.equal(balance(), 12);
  db.exec("UPDATE asset SET amount=40 WHERE id=1");
  assert.equal((await call("DELETE", deposit)).status, 200);
  assert.equal(balance(), 10);
  console.log("Cash flow undo checks passed");
}
async function tradeChecks() {
  db.exec(`INSERT INTO category(id,code,name) VALUES(2,'securities','证券');
    INSERT INTO account(id,category_id,name) VALUES(2,2,'券商');
    INSERT INTO asset(id,account_id,name,symbol,quantity,unit_cost,current_price) VALUES(2,2,'测试','AAPL',10,8,12);
    UPDATE asset SET amount=100 WHERE id=1`);
  const { lastSecuritySubmission } = load("lib/securityTradeUndo");
  const { listSecurityTrades, recordPortfolioEvent } = load("lib/portfolioEvents");
  const { securityLifetimeProfit } = load("lib/securityLifetimeProfit");
  const asset = () => db.prepare("SELECT * FROM asset WHERE id=2").get();
  const post = (path, body) => load("app/api/assets/[id]/" + path + "/route")
    .POST({json: async () => body}, {params:{id:"2"}});
  const undo = id => post("trade/undo", {eventId:id});
  recordPortfolioEvent({type:"security_buy", currency:"CNY", metadata:{category_code:"securities"},
    legs:[{assetId:2, role:"security", assetName:"测试"}]});
  assert.equal(lastSecuritySubmission(2), null);
  let stale;
  for (const [path, body] of [
    ["trade", {side:"buy",price:9,quantity:2,unit_cost:8.2,cash_asset_id:1}],
    ["trade", {side:"sell",price:10,quantity:2,unit_cost:7.5,cash_asset_id:1}],
    ["trade", {side:"sell",price:10,quantity:10,unit_cost:0}],
    ["dividend", {amount:5,cash_asset_id:1}],
    ["liquidate", {price:11,cash_asset_id:1}]
  ]) {
    const startCash = balance();
    const result = await post(path,body);
    assert.equal(result.status,200, JSON.stringify(await result.json()));
    const last = lastSecuritySubmission(2);
    assert.ok(last);
    if (stale) assert.equal((await undo(stale)).status,409);
    if (path==="liquidate") {
      assert.equal(asset(),undefined);
      assert.equal(securityLifetimeProfit(0,"CNY").closed.length,1);
      const available = balance();
      db.exec("UPDATE asset SET amount=0 WHERE id=1");
      assert.equal((await undo(last.id)).status,409);
      assert.equal(asset(),undefined);
      db.prepare("UPDATE asset SET amount=? WHERE id=1").run(available);
    }
    db.exec("UPDATE asset SET amount=amount+2 WHERE id=1");
    const restored = await undo(last.id);
    assert.equal(restored.status,200, JSON.stringify(await restored.json()));
    assert.equal((await undo(last.id)).status,409);
    assert.equal(asset().quantity,10);
    assert.equal(asset().unit_cost,8);
    assert.equal(asset().symbol,"AAPL");
    assert.equal(balance(),startCash+2);
    assert.ok(!listSecurityTrades(2).some(item => item.id===last.id));
    assert.equal(securityLifetimeProfit(0,"CNY").closed.length,0);
    stale=last.id;
  }
  console.log("Security trade undo checks passed");
}
run().then(tradeChecks).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
