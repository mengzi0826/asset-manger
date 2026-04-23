"use client";

import { Download, Upload, Database } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

export function BackupPanel() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const fileRef = useRef<HTMLInputElement>(null);

  async function importFile(f: File) {
    setMsg(null);
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      data.mode = mode;
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg({ text: j.error ?? "导入失败", tone: "error" });
        return;
      }
      setMsg({
        text: `已以「${mode === "merge" ? "合并" : "覆盖"}」模式导入完成`,
        tone: "success"
      });
      start(() => router.refresh());
    } catch (e: any) {
      setMsg({ text: "JSON 解析失败：" + e.message, tone: "error" });
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">备份与恢复</div>
      </div>
      <div className="card-body space-y-4 text-[13px]">
        <div className="flex items-start gap-3 rounded-md border border-hair bg-canvas-sunk/50 p-3 text-[12px] text-ink-500">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <div>
            数据库位置：
            <code className="tabular mx-1 rounded border border-hair bg-canvas-raised px-1.5 py-0.5 text-[11px] text-ink-700">
              ./data/assets.db
            </code>
            。建议定期导出 JSON 备份。
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <a href="/api/backup" className="btn-primary">
            <Download className="h-3.5 w-3.5" /> 导出 JSON 备份
          </a>

          <div className="ml-auto flex items-center gap-2">
            <span className="label mb-0">导入模式</span>
            <div className="segmented">
              {(["merge", "replace"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`segmented-item ${mode === m ? "segmented-item-active" : ""}`}
                >
                  {m === "merge" ? "合并" : "覆盖"}
                </button>
              ))}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={pending}
              className="btn-outline"
            >
              <Upload className="h-3.5 w-3.5" /> 选择 JSON
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {msg && (
          <div
            role={msg.tone === "error" ? "alert" : "status"}
            className={`rounded-md border px-3 py-2 text-[12px] ${
              msg.tone === "error"
                ? "border-loss-100 bg-loss-50 text-loss-700"
                : "border-gain-100 bg-gain-50 text-gain-700"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
