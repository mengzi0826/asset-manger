import { AppStatusBar } from "./_components/AppStatusBar";

export default function Template({ children }: { children: React.ReactNode }) {
  // 随页面导航重新读取底栏数据，避免持久布局保留上一页的统计。
  return (
    <>
      {children}
      <AppStatusBar />
    </>
  );
}
