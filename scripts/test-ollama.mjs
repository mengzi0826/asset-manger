#!/usr/bin/env node

import { fetch } from "undici";

const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = (process.env.OLLAMA_MODEL || "qwen3.5:latest").trim();
const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "请只用一句中文回复：本地模型代码调用成功。";
const timeoutMs = positiveInteger(process.env.OLLAMA_TIMEOUT_MS, 180_000);
const numPredict = positiveInteger(process.env.OLLAMA_NUM_PREDICT, 256);
const think = /^(1|true|yes)$/i.test(process.env.OLLAMA_THINK || "false");

function positiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function requestJson(path, init = {}, timeout = timeoutMs) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    },
    signal: AbortSignal.timeout(timeout)
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} 返回了非 JSON 内容（HTTP ${response.status}）：${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${path} 调用失败（HTTP ${response.status}）：${data?.error || text}`);
  }
  return data;
}

function secondsFromNanoseconds(value) {
  return typeof value === "number" ? `${(value / 1e9).toFixed(2)} 秒` : "未知";
}

async function main() {
  console.log(`Ollama: ${baseUrl}`);
  console.log(`模型: ${model}`);
  console.log(`思考模式: ${think ? "开启" : "关闭"}`);

  const tags = await requestJson("/api/tags", {}, 10_000);
  const installedModels = Array.isArray(tags?.models)
    ? tags.models.map((item) => item?.name).filter(Boolean)
    : [];
  if (!installedModels.includes(model)) {
    throw new Error(
      `未找到模型 ${model}。本机可用模型：${installedModels.join(", ") || "无"}`
    );
  }

  const startedAt = Date.now();
  const result = await requestJson("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model,
      stream: false,
      think,
      messages: [
        {
          role: "system",
          content: "你正在执行本地 API 连通性测试。回答要简短、直接，不要输出 Markdown。"
        },
        { role: "user", content: prompt }
      ],
      options: {
        temperature: 0,
        num_predict: numPredict
      }
    })
  });

  const answer = result?.message?.content?.trim();
  if (!answer) {
    const thinking = result?.message?.thinking?.trim();
    throw new Error(
      thinking
        ? "Ollama 请求成功，但输出额度全部用于思考，message.content 为空；请关闭 OLLAMA_THINK 或提高 OLLAMA_NUM_PREDICT"
        : "Ollama 请求成功，但 message.content 为空"
    );
  }

  console.log("\n模型回复：");
  console.log(answer);
  console.log("\n调用信息：");
  console.log(`- HTTP 往返：${((Date.now() - startedAt) / 1000).toFixed(2)} 秒`);
  console.log(`- Ollama 总耗时：${secondsFromNanoseconds(result.total_duration)}`);
  console.log(`- 输入 token：${result.prompt_eval_count ?? "未知"}`);
  console.log(`- 输出 token：${result.eval_count ?? "未知"}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nOllama demo 失败：${message}`);
  console.error("请确认 Ollama 已启动，并用 `ollama list` 检查模型标签。");
  process.exitCode = 1;
});
