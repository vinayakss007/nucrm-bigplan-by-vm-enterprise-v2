export default function Loading() {
  return (
    <div className="animate-pulse w-full space-y-4">
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="admin-card p-5 space-y-2">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-8 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>
      <div className="admin-card p-5 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 bg-muted rounded-xl" />
        ))}
      </div>
    </div>
  );
}
