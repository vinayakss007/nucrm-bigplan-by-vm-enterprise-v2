export default function Loading() {
  return (
    <div className="animate-pulse space-y-5 max-w-7xl">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_,i) => (
          <div key={i} className="admin-card p-5 space-y-2">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-8 w-24 bg-muted rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[...Array(2)].map((_,i) => (
          <div key={i} className="admin-card p-5 space-y-3">
            <div className="h-5 w-32 bg-muted rounded" />
            {[...Array(5)].map((_,j) => (
              <div key={j} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-1"><div className="h-4 w-40 bg-muted rounded" /><div className="h-3 w-24 bg-muted rounded" /></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
