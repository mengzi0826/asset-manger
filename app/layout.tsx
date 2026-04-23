import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";

export const metadata: Metadata = {
  title: "资产管家",
  description: "专业的个人资产追踪与分析"
};

const themeScript = `
(function(){
  try {
    var stored = localStorage.getItem('theme');
    var isDark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch(e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 尽早写入 dark class，避免 FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-gold-500 focus:px-3 focus:py-1.5 focus:text-sm focus:text-canvas"
        >
          跳到主内容
        </a>
        <div className="min-h-screen">
          <TopNav />
          <main id="main" className="mx-auto max-w-[1200px] px-6 py-7">
            {children}
          </main>
          <footer className="mx-auto max-w-[1200px] px-6 pb-8 pt-4 text-[11px] text-ink-400">
            <span className="tabular">资产管家</span>
            <span className="mx-2 text-hair-strong">·</span>
            <span>本地优先 · 数据仅保存在本机 SQLite</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
