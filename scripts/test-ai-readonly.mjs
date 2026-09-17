#!/usr/bin/env node

import crypto from "node:crypto";
import Database from "better-sqlite3";
import { fetch } from "undici";

const appUrl = (process.env.AI_APP_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

function fingerprintBusinessData() {
  const db = new Database("data/assets.db", { readonly: true });
  const data = {
    account: db.prepare("SELECT * FROM account ORDER BY id").all(),
    asset: db
      .prepare(
        `SELECT id, account_id, name, symbol, currency, quantity, unit_cost,
                amount, annual_rate, start_date, maturity_date, notes, created_at
         FROM asset ORDER BY id`
      )
      .all(),
    assetChange: db.prepare("SELECT * FROM asset_change ORDER BY id").all(),
    portfolioEvent: db.prepare("SELECT * FROM portfolio_event ORDER BY id").all(),
    portfolioEventLeg: db.prepare("SELECT * FROM portfolio_event_leg ORDER BY id").all(),
    stableSettings: db
      .prepare(
        `SELECT key, value FROM setting
         WHERE key NOT LIKE 'last_%'
         ORDER BY key`
      )
      .all()
  };
  db.close();
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

async function main() {
  const before = fingerprintBusinessData();
  const statusResponse = await fetch(`${appUrl}/api/ai`, {
    signal: AbortSignal.timeout(10_000)
  });
  const status = await statusResponse.json();
  if (!statusResponse.ok || !status.available) {
    throw new Error(status.error || `AI 状态异常（HTTP ${statusResponse.status}）`);
  }

  const response = await fetch(`${appUrl}/api/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "chat",
      message: "只告诉我当前净资产金额和基准货币，回答不超过 30 个汉字。"
    }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`对话接口失败（HTTP ${response.status}）：${error}`);
  }
  const answer = (await response.text()).trim();
  if (!answer) throw new Error("对话接口返回空正文");

  const after = fingerprintBusinessData();
  if (before !== after) {
    throw new Error("AI 调用前后业务数据指纹不一致，只读约束未通过");
  }

  console.log(`AI 状态：${status.model} / Ollama ${status.version || "未知"}`);
  console.log(`模型回复：${answer}`);
  console.log(`只读校验：通过（${before.slice(0, 12)}…）`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

