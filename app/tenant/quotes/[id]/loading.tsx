export default function QuoteDetailLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-4 w-32 bg-muted rounded" />
      <div className="flex items-center justify-between">
        <div>
          <div className="h-6 w-48 bg-muted rounded" />
          <div className="h-4 w-24 bg-muted rounded mt-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-20 bg-muted rounded-lg" />
          <div className="h-9 w-20 bg-muted rounded-lg" />
        </div>
      </div>
      <div className="admin-card p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
        <div className="pt-4 border-t border-border space-y-2 max-w-xs ml-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <div className="h-4 w-16 bg-muted rounded" />
              <div className="h-4 w-20 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
