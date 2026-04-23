"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, List, History, Settings } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const ITEMS = [
  { href: "/", label: "总览", icon: LayoutDashboard },
  { href: "/assets", label: "持仓", icon: List },
  { href: "/securities", label: "证券", icon: TrendingUp },
  { href: "/history", label: "历史", icon: History },
  { href: "/settings", label: "设置", icon: Settings }
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-hair bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          aria-label="资产管家首页"
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md bg-gold-500 text-canvas"
            style={{ boxShadow: "0 0 16px -2px rgba(212, 169, 78, 0.4)" }}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 3v18h18" />
              <path d="M7 14l3-3 3 3 5-5" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-ink-900">
              资产管家
            </span>
            <span className="hidden text-[11px] font-medium text-ink-400 sm:inline">
              个人财富追踪
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <nav aria-label="主导航" className="flex items-center gap-1">
            {ITEMS.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`nav-link ${active ? "nav-link-active" : ""}`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <span className="mx-1 h-5 w-px bg-hair" aria-hidden="true" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
