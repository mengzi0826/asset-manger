"use client";

import { useThemeContext, type Theme } from "./themeContext";

export type { Theme };

/**
 * 读取当前主题（'light' | 'dark'）。
 *
 * 实现方式：从 ThemeProvider Context 拿值。
 * SSR 时由 layout.tsx 通过 cookie 解析出初始值并透传给 Provider，
 * 因此服务端与客户端首屏完全一致，不再触发 hydration mismatch。
 */
export function useTheme(): Theme {
  return useThemeContext().theme;
}

/** 直接修改主题。会同步写入 <html class> / localStorage / cookie。 */
export function setTheme(next: Theme): void {
  // 兼容旧调用入口：尽量从 ThemeProvider 走
  // 这里直接操纵 DOM，确保即使在 ThemeProvider 之外（如脚本）调用也能生效
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem("theme", next);
  } catch {}
  document.cookie = `theme=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
