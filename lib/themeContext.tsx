"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const COOKIE_KEY = "theme";
/** 1 年 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeThemeCookie(value: Theme) {
  if (typeof document === "undefined") return;
  // SameSite=Lax 已足够（无跨站需求）；Secure 留给生产 https 环境
  document.cookie = `${COOKIE_KEY}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * 在 Server Component（layout.tsx）从 cookie 读取主题，
 * 把 initial 透传给 ThemeProvider，避免客户端首次渲染与 SSR 不一致。
 */
export function ThemeProvider({
  initial,
  children
}: {
  initial: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initial);

  // 同步 <html class> 与 cookie / localStorage —— 三处一致以兼容 FOUC 内联脚本
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(COOKIE_KEY, theme);
    } catch {}
    writeThemeCookie(theme);
  }, [theme]);

  // 同 tab 的其他组件 / 设备改了 class 时，反向感知（例如开发者手动调试）
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next: Theme = root.classList.contains("dark") ? "dark" : "light";
      setThemeState((prev) => (prev === next ? prev : next));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState((p) => (p === "dark" ? "light" : "dark")),
    []
  );

  const value = useMemo(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // ThemeProvider 未包裹时给一个 SSR 友好的兜底，避免抛错破坏首屏
    return {
      theme: "light",
      setTheme: () => {},
      toggle: () => {}
    };
  }
  return ctx;
}
