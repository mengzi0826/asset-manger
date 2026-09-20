"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function DashboardStatusBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(80);

  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <>
    <div aria-hidden="true" style={{ height }} />
    <footer ref={bar} className="dashboard-footer" aria-label="数据与行情更新">
      <div className="dashboard-footer-inner">{children}</div>
    </footer>
  </>;
}
