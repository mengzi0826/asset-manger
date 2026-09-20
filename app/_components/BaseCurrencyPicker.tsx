"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

const OPTIONS = ["CNY", "USD"] as const;

export function BaseCurrencyPicker({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();

  function showMenu() {
    setAlignLeft((root.current?.getBoundingClientRect().right ?? 0) < 236);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    options.current[Math.max(0, OPTIONS.findIndex((option) => option === current))]?.focus();
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, current]);

  async function update(next: string) {
    setOpen(false);
    trigger.current?.focus();
    if (next === current) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base_currency: next })
      });
      if (!response.ok) throw new Error("币种切换失败，请重试");
      startTransition(() => router.refresh());
    } catch {
      setError("币种切换失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={root}
      className={`currency-picker ${alignLeft ? "currency-align-left" : ""}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button ref={trigger} type="button" className="btn-outline tabular currency-trigger"
        aria-label={`基准货币：${current}`} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-describedby={error ? `${id}-error` : undefined}
        disabled={pending || saving} onClick={() => open ? setOpen(false) : showMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); showMenu(); }
        }}>
        {current}
        {pending || saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && <div id={id} role="menu" aria-label="基准货币" className="currency-menu"
        onKeyDown={(event) => {
          const index = options.current.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? (index + 1) % OPTIONS.length
            : event.key === "ArrowUp" ? (index + OPTIONS.length - 1) % OPTIONS.length
              : event.key === "Home" ? 0 : event.key === "End" ? OPTIONS.length - 1 : null;
          if (next != null) { event.preventDefault(); options.current[next]?.focus(); }
        }}>
        {OPTIONS.map((option, index) => <button key={option} ref={(node) => { options.current[index] = node; }}
          type="button" role="menuitemradio" aria-checked={current === option} tabIndex={-1}
          className="currency-option" onClick={() => update(option)}>
          <span className="tabular font-medium">{option}</span><span className="text-ink-400">{option === "CNY" ? "人民币" : "美元"}</span>
          {current === option && <Check className="ml-auto h-4 w-4 text-brand-600" />}
        </button>)}
      </div>}
      {error && <div id={`${id}-error`} role="alert" className="currency-error">{error}</div>}
    </div>
  );
}
