export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="正在加载页面">
      <span className="sr-only">正在加载页面，请稍候</span>
      <div className="space-y-3 py-2"><div className="skeleton h-4 w-24" /><div className="skeleton h-8 w-40" /></div>
      <div className="card space-y-4 p-7"><div className="skeleton h-4 w-24" /><div className="skeleton h-12 w-2/5" /><div className="skeleton h-4 w-1/3" /></div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]"><div className="skeleton h-80" /><div className="skeleton h-80" /></div>
    </div>
  );
}
