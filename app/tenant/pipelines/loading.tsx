export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 bg-muted rounded-xl" />
        <div className="h-9 w-28 bg-muted rounded-xl" />
      </div>
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-border p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 bg-muted rounded" />
                <div className="h-3 w-64 bg-muted rounded" />
              </div>
              <div className="h-5 w-16 bg-muted rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
