"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { useTransition, useState } from "react";

export function AssetRowActions({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    await fetch(`/api/assets/${id}`, { method: "DELETE" });
    start(() => router.refresh());
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-1">
        <button
          onClick={remove}
          disabled={pending}
          aria-label="确认删除"
          className="btn-danger h-7 px-2"
        >
          <Check className="h-3 w-3" /> 确认
        </button>
        <button
          onClick={() => setConfirming(false)}
          aria-label="取消"
          className="btn-ghost h-7 px-2"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-0.5 opacity-70 transition group-hover:opacity-100">
      <Link
        href={`/assets/${id}`}
        aria-label="编辑"
        className="btn-ghost h-7 w-7 p-0"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <button
        onClick={() => setConfirming(true)}
        aria-label="删除"
        className="btn-ghost h-7 w-7 p-0 text-loss-600 hover:bg-loss-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
