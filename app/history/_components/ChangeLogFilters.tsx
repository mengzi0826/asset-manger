"use client";

import { ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CHANGE_LOG_RANGES,
  CHANGE_LOG_TYPES,
  changeLogHref,
  type ChangeLogFilters as Filters,
  type ChangeLogRange,
  type ChangeLogType
} from "@/lib/changeLog";

export function ChangeLogFilters({ filters }: { filters: Filters }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useState(filters.range);
  const [type, setType] = useState(filters.type);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const [error, setError] = useState(filters.error);

  function apply(nextRange: ChangeLogRange, nextType: ChangeLogType) {
    if (nextRange === "custom" && (!from || !to || from > to)) {
      setError("请选择有效的起止日期，开始日期不能晚于结束日期。");
      return;
    }
    setError(undefined);
    const next = { ...filters, range: nextRange, type: nextType, from, to, page: 1 };
    startTransition(() => router.push(changeLogHref(next, 1, searchParams.toString()), { scroll: false }));
  }

  return (
    <div className="space-y-3 border-b border-hair pb-5" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="日志时间范围">
          {CHANGE_LOG_RANGES.map(item => (
            <button
              key={item.value}
              type="button"
              aria-pressed={range === item.value}
              disabled={pending}
              className={`btn-ghost min-h-9 px-3 ${range === item.value ? "bg-brand-50 text-brand-700" : ""}`}
              onClick={() => {
                setRange(item.value);
                setError(undefined);
                if (item.value !== "custom") apply(item.value, type);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex max-w-full items-center gap-2.5 text-[13px] text-ink-500">
          <span className="shrink-0">变动类型</span>
          <span className="relative min-w-0">
            <select
              className="input-sm block min-h-10 w-28 max-w-full cursor-pointer appearance-none pr-9 font-medium text-ink-800 transition-colors enabled:hover:border-brand-200 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              value={type}
              disabled={pending}
              onChange={event => {
                const value = event.target.value as ChangeLogType;
                setType(value);
                apply(range, value);
              }}
            >
              {CHANGE_LOG_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" strokeWidth={1.75} className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          </span>
        </label>
      </div>
      {range === "custom" && (
        <form
          className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
          onSubmit={event => { event.preventDefault(); apply("custom", type); }}
        >
          <label className="min-w-0 text-[12px] text-ink-500 sm:max-w-48 sm:flex-1">
            开始日期
            <input
              className="input mt-1 min-w-0 px-2 sm:px-3.5"
              type="date"
              required
              value={from}
              disabled={pending}
              onInput={event => setFrom(event.currentTarget.value)}
            />
          </label>
          <label className="min-w-0 text-[12px] text-ink-500 sm:max-w-48 sm:flex-1">
            结束日期
            <input
              className="input mt-1 min-w-0 px-2 sm:px-3.5"
              type="date"
              required
              min={from || undefined}
              value={to}
              disabled={pending}
              onInput={event => setTo(event.currentTarget.value)}
            />
          </label>
          <button type="submit" className="btn-outline col-span-2" disabled={pending}>应用日期</button>
        </form>
      )}
      {error && <p role="alert" className="text-[13px] text-gain-700">{error}</p>}
      <p className="text-[12px] text-ink-400" role="status" aria-live="polite">
        {pending ? "正在更新日志…" : filters.error ? "请调整日期后重新查询。" : (
          <>
            {filters.range === "all" ? "全部时间" : `${filters.from} 至 ${filters.to}（北京时间，含起止日）`}
            <span className="mx-2">·</span>
            {CHANGE_LOG_TYPES.find(item => item.value === filters.type)?.label}
          </>
        )}
      </p>
    </div>
  );
}
