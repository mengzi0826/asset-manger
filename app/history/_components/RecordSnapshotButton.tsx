"use client";

import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RecordSnapshotButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  async function record() {
    await fetch("/api/history", { method: "POST" });
    start(() => router.refresh());
  }
  return (
    <button onClick={record} className="btn-outline" disabled={pending}>
      <Camera className="h-3.5 w-3.5" /> 立即记录快照
    </button>
  );
}
