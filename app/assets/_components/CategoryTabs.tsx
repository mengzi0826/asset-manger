"use client";

import Link from "next/link";
import { formatMoney } from "@/lib/utils";

export function CategoryTabs({
  active,
  tabs,
  currency
}: {
  active: string;
  tabs: Array<{ key: string; label: string; count: number; total: number }>;
  currency: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="资产分类"
      className="flex items-stretch overflow-x-auto border-b border-hair"
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            role="tab"
            aria-selected={isActive}
            href={`/assets${t.key === "all" ? "" : `?cat=${t.key}`}`}
            className={`group relative flex min-w-[120px] shrink-0 flex-col gap-0.5 px-5 py-3 transition-colors duration-150 ${
              isActive ? "text-ink-900" : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <span>{t.label}</span>
              <span
                className={`tabular rounded px-1.5 py-0.5 text-[10px] ${
                  isActive ? "bg-gold-500 text-canvas" : "bg-canvas-sunk text-ink-500"
                }`}
              >
                {t.count}
              </span>
            </div>
            <div className="tabular text-[13px] font-semibold">
              {formatMoney(t.total, currency, 0)}
            </div>
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-gold-500"
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
