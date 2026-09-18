"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { NetWorthChange } from "@/lib/netWorthChange";
import { formatMoney, formatPercent } from "@/lib/utils";
import { NetWorthBreakdown } from "@/components/NetWorthBreakdown";

export function NetWorthDelta({ change, currency }: { change: NetWorthChange; currency: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 340, maxHeight: 480 });
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();
  const value = change.total;

  function show() {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function hideSoon() {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      // 页面在 globals.css 中使用 CSS zoom，DOM 坐标已缩放，fixed 样式需还原到布局像素。
      const zoom = (Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1) *
        (Number.parseFloat(getComputedStyle(document.body).zoom) || 1);
      const width = Math.min(340, (window.innerWidth - 24) / zoom);
      const height = tooltip.current?.scrollHeight ?? 260;
      const below = (window.innerHeight - anchor.bottom - 20) / zoom;
      const above = (anchor.top - 20) / zoom;
      const useAbove = below < Math.min(height, 260) && above > below;
      const maxHeight = Math.max(80, useAbove ? above : below);
      setPosition({
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - width * zoom - 12)) / zoom,
        top: (useAbove ? Math.max(12, anchor.top - Math.min(height, maxHeight) * zoom - 8) : anchor.bottom + 8) / zoom,
        width, maxHeight
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <>
    <button
      ref={trigger}
      type="button"
      className={`chip tabular cursor-help ${value != null && value !== 0 ? value > 0 ? "chip-gain" : "chip-loss" : ""}`}
      aria-label={`${change.comparison}，${value == null ? "暂无对比数据" : formatMoney(value, currency)}，查看净值变化明细`}
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onClick={show}
    >
      {value != null && value !== 0 && (value > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
      {value != null && change.percent != null && <><span className="font-semibold">{formatPercent(change.percent)}</span><span className="opacity-60">·</span></>}
      {value != null && <span>{value > 0 ? "+" : ""}{formatMoney(value, currency)}</span>}
      <span className="opacity-60">{change.comparison}</span>
    </button>
    {open && createPortal(
      <div
        ref={tooltip}
        id={id}
        role="tooltip"
        style={position}
        className="fixed z-50 space-y-3 overflow-y-auto rounded-lg border border-hair-strong bg-canvas-raised p-3.5 shadow-pop"
        onMouseEnter={show}
        onMouseLeave={hideSoon}
      >
        <div className="text-[12px] font-semibold text-ink-800">净值变化明细</div>
        {change.from && <div className="tabular text-[11px] text-ink-400">{change.from} → {change.to} · {currency}</div>}
        <NetWorthBreakdown change={change} currency={currency} compact />
        {change.total != null && <p className="text-[11px] leading-relaxed text-ink-400">
          汇率影响按两端平均外币金额折算。
        </p>}
      </div>, document.body
    )}
  </>;
}
