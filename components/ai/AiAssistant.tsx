"use client";

import {
  Activity,
  Bot,
  CalendarDays,
  CalendarRange,
  FileText,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { AI_ACTION_LABELS, type AiAction } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const MESSAGE_STORAGE_KEY = "asset-manager:ai-messages:v1";
const POSITION_STORAGE_KEY = "asset-manager:ai-dock-y:v1";
const MAX_STORED_MESSAGES = 60;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  pending?: boolean;
  failed?: boolean;
}

interface AiStatus {
  available: boolean;
  model: string;
  version?: string;
  error?: string;
}

const QUICK_ACTIONS: Array<{
  action: Exclude<AiAction, "chat">;
  label: string;
  hint: string;
  icon: typeof Activity;
}> = [
  { action: "checkup", label: "资产体检", hint: "配置与风险", icon: Activity },
  { action: "brief_daily", label: "日报", hint: "今天发生了什么", icon: CalendarDays },
  { action: "brief_weekly", label: "周报", hint: "近 7 日复盘", icon: CalendarRange },
  { action: "brief_monthly", label: "月报", hint: "本月资产总结", icon: FileText }
];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isStoredMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatMessage>;
  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    typeof item.createdAt === "number"
  );
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={index}
              className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.92em] text-ink-800"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      })}
    </>
  );
}

function MessageContent({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      nodes.push(<div key={index} className="h-2" />);
      return;
    }
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      nodes.push(
        <div key={index} className="mb-1 mt-2 font-semibold text-inherit first:mt-0">
          <InlineText text={heading[1]} />
        </div>
      );
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      nodes.push(
        <div key={index} className="flex gap-2 py-0.5">
          <span className="mt-[0.52em] h-1 w-1 shrink-0 rounded-full bg-gold-500" />
          <span><InlineText text={bullet[1]} /></span>
        </div>
      );
      return;
    }
    const numbered = trimmed.match(/^(\d+)[.、]\s+(.+)$/);
    if (numbered) {
      nodes.push(
        <div key={index} className="flex gap-2 py-0.5">
          <span className="min-w-4 font-mono text-[10px] font-semibold text-gold-600">
            {numbered[1]}.
          </span>
          <span><InlineText text={numbered[2]} /></span>
        </div>
      );
      return;
    }
    nodes.push(
      <div key={index} className="py-0.5">
        <InlineText text={trimmed} />
      </div>
    );
  });
  return <div>{nodes}</div>;
}

function WelcomeMessage() {
  return (
    <div className="mx-auto max-w-[290px] py-7 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-gold-200 bg-gold-100 text-gold-700 shadow-sm">
        <Sparkles className="h-[18px] w-[18px]" />
      </div>
      <h3 className="text-[13px] font-semibold text-ink-900">你的本地资产助手</h3>
      <p className="mt-1.5 text-[11px] leading-5 text-ink-500">
        可以自由提问，也可以生成资产体检和简报。每次分析都会读取最新数据，但不会修改任何记录。
      </p>
      <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-hair bg-canvas-sunk px-2.5 py-1 text-[10px] text-ink-500">
        <ShieldCheck className="h-3 w-3 text-loss-500" />
        单轮分析 · 历史不发送给模型
      </div>
    </div>
  );
}

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [dockY, setDockY] = useState(0.62);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      const rawMessages = localStorage.getItem(MESSAGE_STORAGE_KEY);
      if (rawMessages) {
        const parsed = JSON.parse(rawMessages) as unknown;
        if (Array.isArray(parsed)) {
          setMessages(parsed.filter(isStoredMessage).slice(-MAX_STORED_MESSAGES));
        }
      }
      const rawPosition = Number(localStorage.getItem(POSITION_STORAGE_KEY));
      if (Number.isFinite(rawPosition) && rawPosition >= 0.12 && rawPosition <= 0.88) {
        setDockY(rawPosition);
      }
    } catch {
      // 本地缓存损坏时使用默认状态，不影响助手本身。
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const stored = messages
        .filter((message) => !message.pending)
        .slice(-MAX_STORED_MESSAGES)
        .map(({ pending: _pending, ...message }) => message);
      localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(stored));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, messages]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(POSITION_STORAGE_KEY, String(dockY));
  }, [dockY, hydrated]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 180);
  }, [open]);

  useEffect(() => {
    if (!open || statusLoading) return;
    setStatusLoading(true);
    fetch("/api/ai", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as AiStatus;
        setStatus(payload);
      })
      .catch((error) => {
        setStatus({
          available: false,
          model: "qwen3.5:latest",
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => setStatusLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const statusText = useMemo(() => {
    if (statusLoading) return "正在连接本地模型";
    if (status?.available) return status.model;
    if (status) return "Ollama 未连接";
    return "本地模型";
  }, [status, statusLoading]);

  const submit = useCallback(
    async (action: AiAction, text?: string) => {
      if (loading) return;
      const content = text?.trim();
      if (action === "chat" && !content) return;

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        content:
          action === "chat"
            ? content!
            : action === "checkup"
              ? "请对当前资产做一次全面体检"
              : `请生成${AI_ACTION_LABELS[action]}`,
        createdAt: Date.now()
      };
      const assistantId = newId();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        pending: true
      };
      setMessages((current) => [...current, userMessage, assistantMessage]);
      if (action === "chat") setDraft("");
      setLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, message: action === "chat" ? content : undefined }),
          signal: controller.signal
        });
        if (!response.ok) {
          const error = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(error?.error || `请求失败（HTTP ${response.status}）`);
        }
        if (!response.body) throw new Error("服务器没有返回响应流");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content: answer } : message
            )
          );
        }
        answer += decoder.decode();
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: answer.trim() || "模型没有返回正文，请重试。",
                  pending: false
                }
              : message
          )
        );
      } catch (error) {
        const stopped = controller.signal.aborted;
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== assistantId) return message;
            const detail = error instanceof Error ? error.message : String(error);
            return {
              ...message,
              content: stopped
                ? message.content
                  ? `${message.content}\n\n（已停止生成）`
                  : "已停止生成。"
                : `调用失败：${detail}`,
              pending: false,
              failed: !stopped
            };
          })
        );
      } finally {
        abortRef.current = null;
        setLoading(false);
        window.setTimeout(() => inputRef.current?.focus(), 80);
      }
    },
    [loading]
  );

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit("chat", draft);
    }
  };

  const onLauncherPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onLauncherPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
    if (drag.moved) {
      const next = Math.min(0.88, Math.max(0.12, event.clientY / window.innerHeight));
      setDockY(next);
    }
  };

  const onLauncherPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const clearMessages = () => {
    if (loading) abortRef.current?.abort();
    setMessages([]);
    localStorage.removeItem(MESSAGE_STORAGE_KEY);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="打开智能助手；可上下拖动"
          title="智能助手"
          className="group fixed right-[-11px] z-[60] flex h-12 w-12 touch-none select-none items-center justify-center rounded-l-2xl border border-r-0 border-gold-400/60 bg-gradient-to-br from-gold-400 to-gold-600 text-[#0B1020] shadow-[0_12px_28px_-10px_rgba(184,139,58,0.75)] transition-all duration-200 hover:right-0 hover:scale-105 active:scale-95"
          style={{ top: `${dockY * 100}%`, transform: "translateY(-50%)" }}
          onPointerDown={onLauncherPointerDown}
          onPointerMove={onLauncherPointerMove}
          onPointerUp={onLauncherPointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            setOpen(true);
          }}
        >
          <span className="absolute inset-1 rounded-xl border border-white/25" />
          <Bot className="relative h-5 w-5" strokeWidth={2.2} />
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-loss-500 ring-2 ring-gold-500" />
          <span className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md border border-hair bg-canvas-raised px-2 py-1 text-[10px] font-medium text-ink-700 opacity-0 shadow-card transition-opacity group-hover:opacity-100">
            智能助手
          </span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="资产智能助手"
          className="ai-panel-enter fixed bottom-4 right-4 z-[70] flex w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-hair bg-canvas-raised shadow-[0_28px_70px_-20px_rgba(15,23,42,0.42),0_0_0_1px_rgba(184,139,58,0.12)]"
          style={{ height: "min(440px, calc(66.666dvh - 22px))" }}
        >
          <header className="relative overflow-hidden border-b border-white/10 bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#334155] px-4 pb-3 pt-3.5 text-white">
            <div className="pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full bg-gold-500/20 blur-2xl" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-gold-500 shadow-inner">
                  <Sparkles className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-[13px] font-semibold tracking-tight text-white">资产智能助手</h2>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white/65">
                      Local
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-white/55">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        statusLoading
                          ? "animate-pulse bg-gold-400"
                          : status?.available
                            ? "bg-loss-500"
                            : "bg-gain-500"
                      )}
                    />
                    <span className="truncate">{statusText}</span>
                    <span>·</span>
                    <span>只读单轮</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={clearMessages}
                  aria-label="清空本地对话记录"
                  title="清空本地对话记录"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={() => setOpen(false)}
                  aria-label="关闭智能助手"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-4 gap-px border-b border-hair bg-hair">
            {QUICK_ACTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.action}
                  disabled={loading}
                  className="group flex min-w-0 flex-col items-center gap-1 bg-canvas-raised px-1.5 py-2.5 text-center transition-colors hover:bg-gold-50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void submit(item.action)}
                  title={item.hint}
                >
                  <Icon className="h-3.5 w-3.5 text-gold-600 transition-transform group-hover:scale-110" />
                  <span className="truncate text-[9.5px] font-medium text-ink-700">{item.label}</span>
                </button>
              );
            })}
          </div>

          {status && !status.available && (
            <div className="border-b border-gain-100 bg-gain-50 px-3.5 py-2 text-[10px] leading-4 text-gain-700">
              本地模型暂不可用：{status.error || "请确认 Ollama 已启动"}
            </div>
          )}

          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-canvas-sunk/55 px-3.5 py-3.5"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <WelcomeMessage />
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-2",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {message.role === "assistant" && (
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-gold-200 bg-gold-100 text-gold-700">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[84%] rounded-2xl px-3 py-2.5 text-[11px] leading-[1.65] shadow-sm",
                      message.role === "user"
                        ? "rounded-br-md bg-[#1E293B] text-white dark:bg-[#263449]"
                        : "rounded-bl-md border border-hair bg-canvas-raised text-ink-700",
                      message.failed && "border-gain-100 bg-gain-50 text-gain-700"
                    )}
                  >
                    {message.content ? (
                      <MessageContent content={message.content} />
                    ) : (
                      <div className="flex items-center gap-1 py-1" aria-label="模型正在生成">
                        <span className="ai-thinking-dot" />
                        <span className="ai-thinking-dot [animation-delay:140ms]" />
                        <span className="ai-thinking-dot [animation-delay:280ms]" />
                      </div>
                    )}
                    {message.pending && message.content && (
                      <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-gold-500 align-middle" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <footer className="border-t border-hair bg-canvas-raised p-3">
            <div className="flex items-end gap-2 rounded-xl border border-hair bg-canvas-sunk p-1.5 transition-shadow focus-within:border-gold-400 focus-within:shadow-[0_0_0_3px_rgba(184,139,58,0.12)]">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
                onKeyDown={onInputKeyDown}
                rows={1}
                disabled={loading}
                placeholder="问问你的资产…"
                className="max-h-24 min-h-[34px] flex-1 resize-none bg-transparent px-2 py-2 text-[11px] leading-4 text-ink-800 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
              />
              {loading ? (
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gain-100 bg-gain-50 text-gain-700 transition-colors hover:bg-gain-100"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="停止生成"
                  title="停止生成"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!draft.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-500 text-[#0B1020] shadow-sm transition-all hover:bg-gold-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={() => void submit("chat", draft)}
                  aria-label="发送问题"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between px-1 text-[8.5px] text-ink-400">
              <span>Enter 发送 · Shift+Enter 换行</span>
              <span>{draft.length}/2000</span>
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
