"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

const OPTIONS = ["CNY", "USD"] as const;

export function BaseCurrencyPicker({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function update(next: string) {
    if (next === current) return;
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_currency: next })
    });
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="radiogroup"
      aria-label="基准货币"
      className="segmented"
    >
      {OPTIONS.map((opt) => {
        const active = current === opt;
        return (
          <button
            key={opt}
            role="radio"
            aria-checked={active}
            onClick={() => update(opt)}
            disabled={pending}
            className={`segmented-item tabular ${active ? "segmented-item-active" : "hover:text-ink-800"}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
