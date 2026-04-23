"use client";

import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "@/lib/useTheme";

export function ThemeToggle() {
  const theme = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "切换到浅色模式" : "切换到深色模式";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="icon-btn"
      aria-label={label}
      title={label}
    >
      {isDark ? (
        <Sun className="h-4 w-4" strokeWidth={1.8} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.8} />
      )}
    </button>
  );
}
