export default function CallsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-6 w-32 bg-muted rounded" />
          <div className="h-4 w-48 bg-muted rounded mt-2" />
        </div>
        <div className="h-9 w-24 bg-muted rounded-xl" />
      </div>
      <div className="admin-card overflow-hidden rounded-xl border border-border">
        <div className="space-y-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border">
              <div className="w-6 h-6 rounded bg-muted" />
              <div className="w-24 h-4 rounded bg-muted" />
              <div className="w-12 h-4 rounded bg-muted" />
              <div className="w-32 h-4 rounded bg-muted" />
              <div className="w-20 h-4 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
