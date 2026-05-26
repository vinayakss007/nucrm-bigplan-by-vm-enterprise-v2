export default function Loading() {
  return (
    <div className="animate-pulse max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Step indicator skeleton */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-muted" />
            <div className="w-16 h-3 bg-muted rounded hidden sm:block" />
            {i < 3 && <div className="w-8 h-0.5 bg-muted rounded" />}
          </div>
        ))}
      </div>
      {/* Cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="admin-card p-4 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-muted" />
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-3 w-full bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
