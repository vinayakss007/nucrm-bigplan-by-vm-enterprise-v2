export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="h-7 w-40 bg-muted rounded-xl" />
        <div className="h-9 w-32 bg-muted rounded-xl" />
      </div>
      <div className="admin-card divide-y divide-border">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5">
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
            <div className="h-5 w-20 bg-muted rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
