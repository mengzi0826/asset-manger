// Session windows and Tencent quote dates. Does not open SQLite.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Module } = require("node:module");

const filename = path.resolve(__dirname, "../lib/time.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const fixtureModule = new Module(filename, module);
fixtureModule._compile(compiled, filename);
const {
  isAnyStockMarketOpen,
  isHkMarketOpen,
  isHsMarketOpen,
  isUsMarketOpen,
  isUsQuoteDateInDisplayWindow,
  nextStockAutoRefreshIso,
  parseTencentQuoteTimeToSessionYmd,
  shouldRefreshStocks
} = fixtureModule.exports;

const at = (iso) => new Date(iso);
let checks = 0;
function test(name, work) {
  work();
  checks++;
  console.log(`✓ ${name}`);
}

test("A-share and HK morning session", () => {
  const now = at("2026-10-20T10:00:00+08:00");
  assert.equal(isHsMarketOpen(now), true);
  assert.equal(isHkMarketOpen(now), true);
  assert.equal(isUsMarketOpen(now), false);
});

test("lunch break closes both China sessions", () => {
  const now = at("2026-10-20T12:30:00+08:00");
  assert.equal(isHsMarketOpen(now), false);
  assert.equal(isHkMarketOpen(now), false);
  assert.equal(isAnyStockMarketOpen(now), false);
});

test("HK stays open after A-share close", () => {
  const now = at("2026-10-20T15:30:00+08:00");
  assert.equal(isHsMarketOpen(now), false);
  assert.equal(isHkMarketOpen(now), true);
});

test("US summer session maps to Beijing evening and Saturday morning", () => {
  assert.equal(isUsMarketOpen(at("2026-10-20T21:00:00+08:00")), false);
  assert.equal(isUsMarketOpen(at("2026-10-20T21:30:00+08:00")), true);
  assert.equal(isUsMarketOpen(at("2026-10-24T02:00:00+08:00")), true);
  assert.equal(isHsMarketOpen(at("2026-10-24T02:00:00+08:00")), false);
});

test("US winter session starts an hour later in Beijing", () => {
  assert.equal(isUsMarketOpen(at("2026-12-15T22:00:00+08:00")), false);
  assert.equal(isUsMarketOpen(at("2026-12-15T22:30:00+08:00")), true);
  assert.equal(isUsMarketOpen(at("2026-12-16T05:00:00+08:00")), false);
});

test("weekend afternoon is fully closed", () => {
  assert.equal(isAnyStockMarketOpen(at("2026-10-24T12:00:00+08:00")), false);
  assert.equal(isUsMarketOpen(at("2026-10-25T22:00:00+08:00")), false);
});

test("Sunday is closed for all three markets", () => {
  for (const hour of ["00", "12", "23"]) {
    const now = at(`2026-11-01T${hour}:00:00+08:00`);
    assert.equal(isHsMarketOpen(now), false);
    assert.equal(isHkMarketOpen(now), false);
    assert.equal(isUsMarketOpen(now), false);
  }
});

test("US quote visibility follows Beijing calendar days across month/year boundaries", () => {
  assert.equal(isUsQuoteDateInDisplayWindow("2026-12-31", "2027-01-01"), true);
  assert.equal(isUsQuoteDateInDisplayWindow("2026-12-31", "2027-01-02"), false);
  assert.equal(isUsQuoteDateInDisplayWindow("2024-02-29", "2024-03-01"), true);
  assert.equal(isUsQuoteDateInDisplayWindow("2024-02-28", "2024-03-01"), false);
});

test("US daylight-saving changes do not extend the display window", () => {
  assert.equal(isUsQuoteDateInDisplayWindow("2026-10-30", "2026-10-31"), true);
  assert.equal(isUsQuoteDateInDisplayWindow("2026-10-30", "2026-11-01"), false);
  assert.equal(isUsQuoteDateInDisplayWindow("2026-10-30", "2026-11-02"), false);
  assert.equal(isUsQuoteDateInDisplayWindow("2026-03-06", "2026-03-07"), true);
  assert.equal(isUsQuoteDateInDisplayWindow("2026-03-06", "2026-03-08"), false);
});

test("refresh waits 15 minutes only while a market is open", () => {
  const open = at("2026-10-20T10:20:00+08:00");
  assert.equal(shouldRefreshStocks(null, open), true);
  assert.equal(shouldRefreshStocks("2026-10-20T10:10:00+08:00", open), false);
  assert.equal(shouldRefreshStocks("2026-10-20T10:05:00+08:00", open), true);
  assert.equal(shouldRefreshStocks(null, at("2026-10-20T18:00:00+08:00")), false);
});

test("next refresh is the following open, or last plus 15 minutes", () => {
  assert.equal(
    nextStockAutoRefreshIso("2026-10-20T10:05:00+08:00", at("2026-10-20T10:10:00+08:00")),
    "2026-10-20T10:20:00+08:00"
  );
  assert.equal(
    nextStockAutoRefreshIso("2026-10-20T12:00:00+08:00", at("2026-10-20T12:30:00+08:00")),
    "2026-10-20T13:00:00+08:00"
  );
  assert.equal(
    nextStockAutoRefreshIso(null, at("2026-10-24T06:00:00+08:00")),
    "2026-10-26T09:30:00+08:00"
  );
});

test("tencent quote timestamps keep the calendar date in the string", () => {
  assert.equal(parseTencentQuoteTimeToSessionYmd("20261020161450"), "2026-10-20");
  assert.equal(parseTencentQuoteTimeToSessionYmd("2026/10/20 16:08:24"), "2026-10-20");
  assert.equal(parseTencentQuoteTimeToSessionYmd("2026-10-19 16:00:01"), "2026-10-19");
  assert.equal(parseTencentQuoteTimeToSessionYmd(""), null);
  assert.equal(parseTencentQuoteTimeToSessionYmd("20261340161450"), null);
});

console.log(`\n${checks} checks passed`);
