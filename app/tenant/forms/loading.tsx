export default function Loading() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 bg-muted rounded" />
        <div className="h-9 w-28 bg-muted rounded" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="admin-card p-5 space-y-3">
            <div className="h-5 w-32 bg-muted rounded" />
            <div className="h-3 w-full bg-muted rounded" />
            <div className="h-3 w-2/3 bg-muted rounded" />
            <div className="flex gap-2 pt-2">
              <div className="h-8 flex-1 bg-muted rounded" />
              <div className="h-8 flex-1 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
