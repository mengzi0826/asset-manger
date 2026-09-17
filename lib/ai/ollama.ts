import "server-only";
import { fetch as undiciFetch } from "undici";

export interface OllamaStatus {
  available: boolean;
  baseUrl: string;
  model: string;
  installed: boolean;
  version?: string;
  error?: string;
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3.5:latest";

function getConfig() {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
    model: (process.env.OLLAMA_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: positiveInteger(process.env.OLLAMA_TIMEOUT_MS, 300_000),
    numPredict: positiveInteger(process.env.OLLAMA_NUM_PREDICT, 1600),
    numCtx: positiveInteger(process.env.OLLAMA_NUM_CTX, 16_384)
  };
}

function positiveInteger(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function readError(response: Awaited<ReturnType<typeof undiciFetch>>) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || text;
  } catch {
    return text;
  }
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const config = getConfig();
  try {
    const [tagsResponse, versionResponse] = await Promise.all([
      undiciFetch(`${config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000)
      }),
      undiciFetch(`${config.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(5_000)
      }).catch(() => null)
    ]);
    if (!tagsResponse.ok) {
      return {
        available: false,
        installed: false,
        baseUrl: config.baseUrl,
        model: config.model,
        error: await readError(tagsResponse)
      };
    }
    const tags = (await tagsResponse.json()) as {
      models?: Array<{ name?: string }>;
    };
    const installed = (tags.models ?? []).some((item) => item.name === config.model);
    let version: string | undefined;
    if (versionResponse?.ok) {
      const value = (await versionResponse.json()) as { version?: string };
      version = value.version;
    }
    return {
      available: installed,
      installed,
      baseUrl: config.baseUrl,
      model: config.model,
      version,
      error: installed ? undefined : `本机未安装模型 ${config.model}`
    };
  } catch (error) {
    return {
      available: false,
      installed: false,
      baseUrl: config.baseUrl,
      model: config.model,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 请求 Ollama NDJSON 流。模型默认关闭 thinking，避免短对话把输出额度全部耗在思考阶段。
 */
export async function requestOllamaChatStream(
  messages: OllamaMessage[],
  options: { numPredict?: number } = {}
) {
  const config = getConfig();
  const response = await undiciFetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      think: false,
      keep_alive: "10m",
      messages,
      options: {
        temperature: 0.15,
        num_predict: process.env.OLLAMA_NUM_PREDICT
          ? config.numPredict
          : options.numPredict ?? config.numPredict,
        num_ctx: config.numCtx
      }
    }),
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) throw new Error("Ollama 未返回响应流");
  return { response, model: config.model };
}
