export default function Loading() {
  return (
    <div className="animate-pulse space-y-5 max-w-7xl">
      {/* Hero skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-4 w-96 bg-muted rounded" />
      </div>
      {/* Stats cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="admin-card p-5 space-y-2">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-8 w-24 bg-muted rounded" />
          </div>
        ))}
      </div>
      {/* Pipeline skeleton */}
      <div className="admin-card p-5 space-y-3">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 flex-1 bg-muted rounded" />
          ))}
        </div>
      </div>
      {/* Quick actions skeleton */}
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="admin-card p-5 space-y-2">
            <div className="h-8 w-8 bg-muted rounded-full" />
            <div className="h-4 w-20 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
