import { NextResponse } from "next/server";
import { z } from "zod";
import { AI_ACTIONS } from "@/lib/ai/types";
import { buildAiMessages } from "@/lib/ai/context";
import { getOllamaStatus, requestOllamaChatStream } from "@/lib/ai/ollama";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OUTPUT_BUDGET: Record<(typeof AI_ACTIONS)[number], number> = {
  chat: 400,
  checkup: 700,
  brief_daily: 550,
  brief_weekly: 700,
  brief_monthly: 850
};

const requestSchema = z
  .object({
    action: z.enum(AI_ACTIONS),
    message: z.string().trim().max(2000).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "chat" && !value.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "请输入问题"
      });
    }
  });

export async function GET() {
  const status = await getOllamaStatus();
  return NextResponse.json(status, { status: status.available ? 200 : 503 });
}

export async function POST(req: Request) {
  try {
    const parsed = requestSchema.parse(await req.json());
    const { messages } = buildAiMessages(parsed.action, parsed.message);
    const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    const { response, model } = await requestOllamaChatStream(messages, {
      numPredict: OUTPUT_BUDGET[parsed.action]
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let emitted = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const payload = JSON.parse(line) as {
                message?: { content?: string };
                error?: string;
                done?: boolean;
                prompt_eval_count?: number;
                eval_count?: number;
                total_duration?: number;
              };
              if (payload.error) throw new Error(payload.error);
              const content = payload.message?.content;
              if (content) {
                emitted = true;
                controller.enqueue(encoder.encode(content));
              }
              if (payload.done) {
                console.info(
                  `[ai] action=${parsed.action} model=${model} prompt_chars=${promptChars} prompt_tokens=${payload.prompt_eval_count ?? "?"} output_tokens=${payload.eval_count ?? "?"} duration_ms=${payload.total_duration ? Math.round(payload.total_duration / 1e6) : "?"}`
                );
              }
            }
            if (done) break;
          }
          if (buffer.trim()) {
            const payload = JSON.parse(buffer) as {
              message?: { content?: string };
              error?: string;
            };
            if (payload.error) throw new Error(payload.error);
            if (payload.message?.content) {
              emitted = true;
              controller.enqueue(encoder.encode(payload.message.content));
            }
          }
          if (!emitted) controller.enqueue(encoder.encode("模型没有返回正文，请稍后重试。"));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        void reader.cancel();
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        "x-ai-model": model,
        "x-ai-memory": "single-turn",
        "x-ai-prompt-chars": String(promptChars)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isInputError = error instanceof z.ZodError;
    return NextResponse.json(
      { error: isInputError ? error.issues[0]?.message ?? "请求格式错误" : message },
      { status: isInputError ? 400 : 503 }
    );
  }
}
