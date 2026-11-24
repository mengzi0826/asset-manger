// Query fixtures use an in-memory database; never opens data/assets.db.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Module } = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

const project = path.resolve(__dirname, "..");
const db = new Database(":memory:");
db.exec(fs.readFileSync(path.join(project, "lib/schema.sql"), "utf8"));
const modules = new Map();
function load(filename) {
  const resolved = path.resolve(project, filename);
  if (modules.has(resolved)) return modules.get(resolved).exports;
  const compiledModule = new Module(resolved, module);
  modules.set(resolved, compiledModule);
  compiledModule.filename = resolved;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(resolved));
  compiledModule.require = id => {
    if (resolved.endsWith("/lib/history.ts")) {
      if (id === "./db") return { getDB: () => db };
      if (["./fx", "./valuation", "./stocks"].includes(id)) return {};
    }
    if (id.startsWith(".")) return load(`${path.resolve(path.dirname(resolved), id)}.ts`);
    return require(id);
  };
  compiledModule._compile(ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, resolved);
  return compiledModule.exports;
}

const { parseChangeLogFilters, changeLogHref, getChangeLogType, parseChangeFields } = load("lib/changeLog.ts");
const { listChangesPage, listChanges } = load("lib/history.ts");
const today = "2026-11-11";
const filters = params => parseChangeLogFilters(params, today);
const diff = (field, to) => ({ [field]: { from: null, to } });
const insert = db.prepare(`INSERT INTO asset_change (id, action, created_at, field_changes)
  VALUES (@id, @action, @created_at, @field_changes)`);
function reset(rows) {
  db.prepare("DELETE FROM asset_change").run();
  db.transaction(() => {
    for (const row of rows) insert.run({ action: "update", created_at: `${today}T12:00:00+08:00`, field_changes: null, ...row });
  })();
}
let checks = 0;
function test(name, work) { work(); checks++; console.log(`✓ ${name}`); }

test("defaults to 30 Beijing calendar days including today", () => {
  assert.deepEqual(filters({}), { range: "30d", type: "all", page: 1, from: "2026-10-13", to: today });
  assert.equal(filters({ logRange: "7d" }).from, "2026-11-05");
});
test("month presets handle leap February and year boundaries", () => {
  assert.equal(filters({ logRange: "month" }).from, "2026-11-01");
  const leap = parseChangeLogFilters({ logRange: "last-month" }, "2024-03-15");
  assert.equal(leap.from, "2024-02-01");
  assert.equal(leap.to, "2024-02-29");
  const year = parseChangeLogFilters({ logRange: "last-month" }, "2026-01-01");
  assert.equal(year.from, "2025-12-01");
  assert.equal(year.to, "2025-12-31");
});
test("all time clears stale dates, malformed pagination falls back safely", () => {
  const all = filters({ logRange: "all", logFrom: "2020-01-01", logTo: "2020-01-02" });
  assert.equal(all.from, undefined);
  assert.equal(all.to, undefined);
  for (const page of ["0", "-2", "1.5", "NaN", "Infinity", "9007199254740992"]) {
    assert.equal(filters({ logPage: page }).page, 1);
  }
  assert.equal(filters({ logRange: "unknown", logType: "unknown" }).range, "30d");
  assert.equal(filters({ logType: ["expense", "create"] }).type, "expense");
});
test("custom dates reject impossible, missing and reversed ranges", () => {
  for (const params of [
    { logFrom: "2026-02-30", logTo: "2026-03-01" },
    { logFrom: "2026-11-12", logTo: today },
    { logFrom: today }
  ]) assert.ok(filters({ logRange: "custom", ...params }).error);
  const oneDay = filters({ logRange: "custom", logFrom: today, logTo: today });
  assert.equal(oneDay.error, undefined);
  assert.equal(oneDay.from, oneDay.to);
});
test("navigation preserves other query parameters and resets page on filtering", () => {
  const href = changeLogHref(filters({ logRange: "7d", logType: "expense" }), 1,
    "chart=year&logRange=custom&logPage=9&logFrom=2020-01-01&logTo=2020-01-02");
  const url = new URL(href, "http://localhost");
  assert.equal(url.searchParams.get("chart"), "year");
  assert.equal(url.searchParams.get("logPage"), null);
  assert.equal(url.searchParams.get("logFrom"), null);
  assert.equal(url.searchParams.get("logRange"), "7d");
  assert.equal(url.searchParams.get("logType"), "expense");
  assert.equal(url.hash, "#change-log");
  const custom = changeLogHref(filters({ logRange: "custom", logFrom: today, logTo: today }), 3);
  assert.ok(custom.includes("logFrom=2026-11-11"));
  assert.ok(custom.includes("logPage=3"));
});
test("pagination reaches every record beyond the former 500-row cap, without duplicates", () => {
  reset(Array.from({ length: 541 }, (_, index) => ({ id: index + 1 })));
  const ids = [];
  for (let page = 1; page <= 28; page++) {
    const result = listChangesPage(filters({ logPage: String(page) }));
    assert.equal(result.total, 541);
    assert.equal(result.pageCount, 28);
    assert.equal(result.changes.length, page === 28 ? 1 : 20);
    ids.push(...result.changes.map(row => row.id));
  }
  assert.deepEqual(ids, Array.from({ length: 541 }, (_, index) => 541 - index));
  const clamped = listChangesPage(filters({ logPage: "9999" }));
  assert.equal(clamped.page, 28);
  assert.equal(clamped.changes[0].id, 1);
  assert.equal(listChanges(8).length, 8, "overview reader keeps its original contract");
});
test("Beijing date boundaries include midnight and end-of-day across legacy UTC formats", () => {
  reset([
    { id: 1, created_at: "2026-11-10T23:59:59+08:00" },
    { id: 2, created_at: "2026-11-10 16:00:00" },
    { id: 3, created_at: "2026-11-10T16:00:00Z" },
    { id: 4, created_at: "2026-11-11T00:00:00+08:00" },
    { id: 5, created_at: "2026-11-11T23:59:59.999+08:00" },
    { id: 6, created_at: "2026-11-12T00:00:00+08:00" },
    { id: 7, created_at: "2026-11-11T01:00:00+08:00" },
    { id: 8, created_at: "2026-11-10T18:00:00" }
  ]);
  const result = listChangesPage(filters({ logRange: "custom", logFrom: today, logTo: today }));
  assert.deepEqual(result.changes.map(row => row.id), [5, 8, 7, 4, 3, 2]);
  assert.deepEqual(listChanges().map(row => row.id), [6, 5, 8, 7, 4, 3, 2, 1]);
});
test("the rolling window includes day 30 and excludes day 31 and future days", () => {
  reset([
    { id: 1, created_at: "2026-10-12T23:59:59+08:00" },
    { id: 2, created_at: "2026-10-13T00:00:00+08:00" },
    { id: 3 },
    { id: 4, created_at: "2026-11-12T00:00:00+08:00" }
  ]);
  assert.deepEqual(listChangesPage(filters({})).changes.map(row => row.id), [3, 2]);
  assert.equal(listChangesPage(filters({ logRange: "all" })).total, 4);
});
test("type filters agree with displayed labels and general edits exclude named operations", () => {
  reset([
    { id: 1, action: "create", field_changes: JSON.stringify(diff("cash_flow_type", "interest")) },
    { id: 2, action: "delete" },
    { id: 3, field_changes: JSON.stringify(diff("quantity", 100)) },
    { id: 4, field_changes: JSON.stringify(diff("cash_flow_type", "deposit")) },
    { id: 5, field_changes: JSON.stringify(diff("cash_flow_type", "expense")) },
    { id: 6, field_changes: JSON.stringify(diff("cash_flow_type", "interest")) },
    { id: 7, field_changes: JSON.stringify(diff("dividend_amount", 120)) },
    { id: 8, field_changes: "malformed JSON" },
    { id: 9, field_changes: '{"cash_flow_type":{"to":"unknown"}}' },
    { id: 10, field_changes: '[{"cash_flow_type":{"to":"interest"}}]' }
  ]);
  const all = listChangesPage(filters({})).changes;
  for (const type of ["create", "delete", "update", "deposit", "expense", "interest", "dividend"]) {
    const result = listChangesPage(filters({ logType: type }));
    assert.deepEqual(result.changes.map(row => row.id), all.filter(row => getChangeLogType(row) === type).map(row => row.id));
  }
  assert.deepEqual(listChangesPage(filters({ logType: "update" })).changes.map(row => row.id), [10, 9, 8, 3]);
});
test("database applies type and date filters before pagination and counts all matches", () => {
  reset([
    ...Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })),
    ...Array.from({ length: 25 }, (_, index) => ({ id: index + 101, field_changes: JSON.stringify(diff("cash_flow_type", "expense")) })),
    { id: 126, created_at: "2026-01-01T12:00:00+08:00", field_changes: JSON.stringify(diff("cash_flow_type", "expense")) }
  ]);
  const result = listChangesPage(filters({ logType: "expense", logPage: "2" }));
  assert.equal(result.total, 25);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.changes.map(row => row.id), [105, 104, 103, 102, 101]);
});
test("empty matches and invalid custom dates produce no records", () => {
  reset([{ id: 1 }]);
  const empty = listChangesPage(filters({ logType: "interest", logPage: "999" }));
  assert.deepEqual(empty, { changes: [], total: 0, page: 1, pageCount: 1 });
  assert.equal(listChangesPage(filters({ logRange: "custom", logFrom: "invalid", logTo: today })).total, 0);
});
test("malformed historical field diffs are safe to render", () => {
  for (const raw of [null, "bad JSON", "null", "[]", '"text"', '{"amount":null}', '{"amount":4}']) {
    assert.deepEqual(parseChangeFields(raw), {});
  }
  assert.deepEqual(parseChangeFields('{"amount":{"from":1,"to":2},"notes":null}'), { amount: { from: 1, to: 2 } });
});
test("time-range queries use the expression index for mixed timestamp formats", () => {
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM asset_change
    WHERE julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?, '+1 day')
    ORDER BY julianday(created_at) DESC, id DESC LIMIT ? OFFSET ?`)
    .all(`${today}T00:00:00+08:00`, `${today}T00:00:00+08:00`, 20, 0);
  assert.ok(plan.some(row => row.detail.includes("idx_asset_change_instant")), JSON.stringify(plan));
});

db.close();
console.log(`\n${checks} change-log checks passed.`);
