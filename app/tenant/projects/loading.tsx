export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 bg-muted rounded-xl" />
        <div className="h-9 w-32 bg-muted rounded-xl" />
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border"><div className="h-5 w-32 bg-muted rounded" /></div>
        <div className="divide-y divide-border">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-3 w-32 bg-muted rounded" />
              </div>
              <div className="h-5 w-16 bg-muted rounded-full" />
              <div className="h-2 w-24 bg-muted rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
