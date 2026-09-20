"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, LayoutDashboard, TrendingUp, Wallet, History, Settings, ShieldCheck, Sparkles, ArrowUpRight, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { ThemeToggle } from "./ThemeToggle";

const ITEMS = [
  { href: "/", label: "总览", icon: LayoutDashboard },
  { href: "/assets", label: "资产", icon: Wallet },
  { href: "/securities", label: "证券", icon: TrendingUp },
  { href: "/history", label: "历史", icon: History },
  { href: "/settings", label: "设置", icon: Settings }
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <aside className="app-sidebar">
      <Link href="/" className="app-brand" aria-label="资产管家首页">
        <span className="brand-mark"><BarChart3 className="h-6 w-6" strokeWidth={2.4} /></span>
        <strong>资产管家</strong>
      </Link>
      <nav aria-label="主导航" className="app-navigation">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`nav-link ${active ? "nav-link-active" : ""}`}
            onClick={(e) => { if (pathname === href) { e.preventDefault(); startTransition(() => router.refresh()); } }}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} /><span>{label}</span>
            {active && pending && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" aria-label="刷新中" />}
          </Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className="assistant-shortcut" onClick={() => window.dispatchEvent(new Event("asset-manager:open-ai"))}>
          <Sparkles className="h-5 w-5" /><strong>AI 助手</strong><ArrowUpRight className="ml-auto h-4 w-4" />
        </button>
        <div className="sidebar-status"><ShieldCheck className="h-4 w-4" /><span>数据仅保存在本机</span></div>
        <div className="sidebar-appearance"><span>外观模式</span><ThemeToggle /></div>
      </div>
      <div className="mobile-theme"><ThemeToggle /></div>
    </aside>
  );
}
