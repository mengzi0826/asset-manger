"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type ConfirmOptions = { title?: string; description: string; confirmLabel?: string };
type Confirm = (options: ConfirmOptions | string) => Promise<boolean>;
const Context = createContext<Confirm | null>(null);

/** UI-only replacement for browser confirm; cancellation never runs the caller's action. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const confirm = useCallback<Confirm>((next) => new Promise((done) => {
    resolve.current?.(false);
    resolve.current = done;
    setOptions(typeof next === "string" ? { description: next } : next);
  }), []);

  useEffect(() => { if (options) dialog.current?.showModal(); }, [options]);
  useEffect(() => () => resolve.current?.(false), []);

  function finish(accepted: boolean) {
    dialog.current?.close();
    resolve.current?.(accepted);
    resolve.current = null;
    setOptions(null);
  }

  return (
    <Context.Provider value={confirm}>
      {children}
      <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
        onCancel={(event) => { event.preventDefault(); finish(false); }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gain-50 text-gain-700"><AlertTriangle className="h-5 w-5" /></div>
          <button type="button" className="icon-btn" aria-label="关闭确认对话框" onClick={() => finish(false)}><X className="h-4 w-4" /></button>
        </div>
        <h2 id={titleId} className="mt-5 text-lg font-semibold text-ink-900">{options?.title ?? "确认此操作"}</h2>
        <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm leading-7 text-ink-600">{options?.description}</p>
        <div className="mt-7 flex justify-end gap-3">
          <button type="button" autoFocus className="btn-outline" onClick={() => finish(false)}>取消</button>
          <button type="button" className="btn-danger" onClick={() => finish(true)}>{options?.confirmLabel ?? "确认操作"}</button>
        </div>
      </dialog>
    </Context.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(Context);
  if (!confirm) throw new Error("useConfirm requires ConfirmProvider");
  return confirm;
}
