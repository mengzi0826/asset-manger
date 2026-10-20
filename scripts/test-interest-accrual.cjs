// Accrues against a copy of the database. Does not open data/assets.db.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Module } = require("node:module");
const ts = require("typescript");
const { execFileSync } = require("node:child_process");

const project = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "interest-accrual-"));
fs.mkdirSync(path.join(temp, "data"));
fs.mkdirSync(path.join(temp, "lib"));
execFileSync("sqlite3", [
  path.join(project, "data/assets.db"),
  `.backup ${path.join(temp, "data/assets.db")}`
]);
fs.copyFileSync(path.join(project, "lib/schema.sql"), path.join(temp, "lib/schema.sql"));
process.chdir(temp);

const modules = new Map();
function load(file) {
  const resolved = path.resolve(file);
  if (!resolved.endsWith(".ts")) throw new Error(`not a ts file: ${resolved}`);
  const existing = modules.get(resolved);
  if (existing) return existing.exports;
  const compiledModule = new Module(resolved);
  modules.set(resolved, compiledModule);
  const compiled = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  compiledModule.filename = resolved;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(resolved));
  compiledModule.require = (id) => {
    if (id === "server-only") return {};
    if (id.startsWith(".")) {
      const target = path.resolve(path.dirname(resolved), id);
      return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : target);
    }
    return require(id);
  };
  compiledModule._compile(compiled, resolved);
  return compiledModule.exports;
}

const dbMod = load(path.join(project, "lib/db.ts"));
const { dailyInterest } = load(path.join(project, "lib/interestMath.ts"));
const { saveInterestRates, accrueTodayInterest, getInterestStatus } = load(path.join(project, "lib/interest.ts"));
const db = dbMod.getDB();

function sum(category, currency) {
  const rows = db.prepare(
    `SELECT a.amount, a.quantity, a.current_price, a.unit_cost
     FROM asset a
     JOIN account acc ON acc.id = a.account_id
     JOIN category c ON c.id = acc.category_id
     WHERE c.code = ? AND a.currency = ?
       AND COALESCE(acc.notes, '') NOT LIKE 'interest:%'`
  ).all(category, currency);
  return rows.reduce((total, row) => {
    if (row.amount != null && row.amount > 0) return total + row.amount;
    return total + (row.quantity ?? 0) * (row.current_price ?? row.unit_cost ?? 0);
  }, 0);
}

const before = {
  cny: sum("cash", "CNY"),
  hkd: sum("cash", "HKD"),
  usd: sum("cash", "USD"),
  crypto: sum("crypto", "USD")
};
const rates = { cny: 0.02, hkd: 0.01, usd: 0.015, crypto: 0.05 };
saveInterestRates(rates);

const accounts = db.prepare(
  "SELECT c.code AS category, acc.notes, a.name, a.currency, a.amount FROM account acc JOIN category c ON c.id = acc.category_id JOIN asset a ON a.account_id = acc.id WHERE acc.notes LIKE 'interest:%' ORDER BY acc.notes"
).all();
assert.deepEqual(accounts.map((row) => row.notes), ["interest:cny", "interest:crypto", "interest:hkd", "interest:usd"]);
assert.deepEqual(accounts.map((row) => [row.category, row.currency]), [
  ["cash", "CNY"], ["crypto", "USD"], ["cash", "HKD"], ["cash", "USD"]
]);

function interestOf(note) {
  return db.prepare(
    "SELECT a.amount FROM asset a JOIN account acc ON acc.id = a.account_id WHERE acc.notes = ?"
  ).get(note).amount;
}
assert.equal(interestOf("interest:cny"), dailyInterest(before.cny, rates.cny));
assert.equal(interestOf("interest:hkd"), dailyInterest(before.hkd, rates.hkd));
assert.equal(interestOf("interest:usd"), dailyInterest(before.usd, rates.usd));
assert.equal(interestOf("interest:crypto"), dailyInterest(before.crypto, rates.crypto));

const events = db.prepare("SELECT event_type, reason, gross_amount, currency FROM portfolio_event WHERE event_type = 'interest_income' ORDER BY currency").all();
assert.equal(events.length, 4);
assert.ok(events.every((event) => event.reason === "利息收入"));

const again = interestOf("interest:cny");
accrueTodayInterest();
assert.equal(interestOf("interest:cny"), again);

saveInterestRates({ ...rates, cny: 0.04 });
assert.equal(interestOf("interest:cny"), dailyInterest(before.cny, 0.04));
const revised = db.prepare("SELECT COUNT(*) AS n FROM portfolio_event WHERE event_type = 'interest_income' AND currency = 'CNY'").get();
assert.equal(revised.n, 1);

saveInterestRates({ ...rates, cny: 0 });
assert.equal(interestOf("interest:cny"), 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM portfolio_event WHERE event_type = 'interest_income' AND currency = 'CNY'").get().n, 0);

const status = getInterestStatus().find((bucket) => bucket.id === "hkd");
assert.equal(status.accrued, true);
assert.equal(status.principal, before.hkd);
assert.equal(status.todayInterest, dailyInterest(before.hkd, rates.hkd));

db.close();
fs.rmSync(temp, { recursive: true, force: true });
console.log("interest accrual checks passed");
