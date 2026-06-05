export default function Loading() {
  return (
    <div className="animate-pulse space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-5 w-40 bg-white/10 rounded" />
          <div className="h-3 w-60 bg-white/5 rounded" />
        </div>
        <div className="h-9 w-28 bg-white/10 rounded-xl" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
            <div className="h-3 w-20 bg-white/10 rounded" />
            <div className="h-7 w-12 bg-white/10 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-48 rounded-xl bg-white/5" />
        ))}
      </div>
    </div>
  );
}
