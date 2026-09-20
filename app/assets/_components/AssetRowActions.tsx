"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { useTransition, useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { editAssetHref } from "@/lib/assetsNav";

export function AssetRowActions({ id, returnCat = "all" }: { id: number; returnCat?: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [refreshing, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = refreshing || saving;

  async function remove() {
    if (pending) return;
    if (!await confirm({ title: "删除这笔资产？", description: "资产将从当前列表中移除，历史变动记录仍会保留。", confirmLabel: "删除资产" })) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "删除失败，请重试");
        return;
      }
      start(() => router.refresh());
    } catch { setError("连接失败，请重试"); }
    finally { setSaving(false); }
  }

  return (
    <div className="relative">
      <div className="inline-flex items-center gap-1">
        <Link href={editAssetHref(id, returnCat) + (returnCat === "all" ? "?cat=all" : "")} aria-label="编辑" className="icon-btn"><Pencil className="h-3.5 w-3.5" /></Link>
        <button type="button" onClick={remove} disabled={pending} aria-label="删除" className="icon-btn hover:border-gain-100 hover:bg-gain-50 hover:text-gain-700">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 max-w-40 text-xs text-gain-700">{error}</p>}
    </div>
  );
}
