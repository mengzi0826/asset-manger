"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

export function PositionDetails({ holdings, closed, hasHoldings, hasClosed, showClosed }: {
  holdings: ReactNode;
  closed: ReactNode;
  hasHoldings: boolean;
  hasClosed: boolean;
  showClosed: boolean;
}) {
  const [view, setView] = useState<"持仓明细" | "已清仓">(
    (showClosed || !hasHoldings) && hasClosed ? "已清仓" : "持仓明细"
  );
  return (
    <section className="card">
      <div className="card-header">
        <div className="segmented" role="group" aria-label="证券明细">
          {(["持仓明细", "已清仓"] as const).map(label => (
            <button
              key={label}
              type="button"
              aria-pressed={view === label}
              className={`segmented-item ${view === label ? "segmented-item-active" : "text-ink-400 hover:text-ink-700"}`}
              onClick={() => setView(label)}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "持仓明细" && hasHoldings && (
          <Link href="/assets" className="inline-flex items-center gap-1 text-[12px] text-ink-500 hover:text-gold-500">
            编辑 <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      {view === "已清仓" ? closed : (
        <div className="card-body">
          {hasHoldings ? holdings : <p className="text-sm text-ink-500">暂无当前持仓。</p>}
        </div>
      )}
    </section>
  );
}
