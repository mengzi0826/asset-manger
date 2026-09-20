"use client";

import { useId, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";

export function OperationSheet({ title, description, action, children }: {
  title: string; description: string; action: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <section className="card operation-entry">
      <div className="min-w-0"><h2 className="card-title">{title}</h2><p className="mt-1.5 text-sm text-ink-500">{description}</p></div>
      <button type="button" className="btn-outline shrink-0" onClick={() => ref.current?.showModal()}>{action}<ArrowUpRight className="h-4 w-4" /></button>
      <dialog ref={ref} className="operation-sheet" aria-labelledby={id}>
        <div className="operation-sheet-header"><div><div className="eyebrow">资产操作</div><h2 id={id} className="mt-1 text-xl font-semibold">{title}</h2></div>
          <button type="button" className="icon-btn" aria-label="关闭操作面板" onClick={() => ref.current?.close()}><X className="h-4 w-4" /></button>
        </div>
        <div className="operation-sheet-body">{children}</div>
      </dialog>
    </section>
  );
}
