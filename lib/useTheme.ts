"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * 读取和响应 <html> 上的 dark class。
 * 用 MutationObserver 监听 class 变化，确保所有使用该 hook 的组件
 * （尤其是 recharts 图表）在用户切换主题时实时同步颜色。
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function setTheme(next: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem("theme", next);
  } catch {}
}
