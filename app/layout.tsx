import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { ThemeProvider, type Theme } from "@/lib/themeContext";
import { startAutoRefreshScheduler } from "@/lib/autoRefresh";

export const metadata: Metadata = {
  title: "资产管家",
  description: "专业的个人资产追踪与分析"
};

startAutoRefreshScheduler();

const themeScript = `
(function(){
  try {
    var ck = document.cookie.split('; ').find(function(c){return c.indexOf('theme=')===0;});
    var stored = ck ? ck.slice(6) : localStorage.getItem('theme');
    var isDark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch(e) {}
})();
`;

/**
 * 服务端解析当前主题：
 *   1) cookie 已写入 → 优先用
 *   2) 没 cookie 时回落到客户端 prefers-color-scheme（请求头），找不到则 light
 *
 * Next.js 暂不直接暴露媒体查询，但部分浏览器会把 `Sec-CH-Prefers-Color-Scheme`
 * 发到服务端；用它做一次猜测，能进一步减少首屏闪烁。
 */
function resolveTheme(): Theme {
  const ck = cookies().get("theme")?.value;
  if (ck === "dark" || ck === "light") return ck;
  const hint = headers().get("sec-ch-prefers-color-scheme");
  if (hint === "dark") return "dark";
  return "light";
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = resolveTheme();
  return (
    <html lang="zh-CN" className={theme === "dark" ? "dark" : undefined}>
      <head>
        {/* 兜底：cookie/localStorage 失效时仍尽早写 dark class，避免 FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-gold-500 focus:px-3 focus:py-1.5 focus:text-sm focus:text-canvas"
        >
          跳到主内容
        </a>
        <ThemeProvider initial={theme}>
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
        </ThemeProvider>
      </body>
    </html>
  );
}
