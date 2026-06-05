export default function Loading() {
  return (
    <div className="animate-pulse space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/10" />
        <div className="space-y-1">
          <div className="h-5 w-32 bg-white/10 rounded" />
          <div className="h-3 w-48 bg-white/5 rounded" />
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
        <div className="h-4 w-28 bg-white/10 rounded" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-9 bg-white/5 rounded-lg" />
          <div className="h-9 bg-white/5 rounded-lg" />
        </div>
        <div className="h-16 bg-white/5 rounded-lg" />
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
        <div className="h-4 w-20 bg-white/10 rounded" />
        <div className="grid grid-cols-3 gap-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-8 bg-white/5 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
