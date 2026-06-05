export default function Loading() {
  return (
    <div className="animate-pulse w-full flex gap-4 h-[calc(100vh-12rem)]">
      <div className="w-80 space-y-3">
        <div className="h-7 w-32 bg-muted rounded" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="admin-card p-4 space-y-2">
            <div className="h-4 w-28 bg-muted rounded" />
            <div className="h-3 w-full bg-muted rounded" />
          </div>
        ))}
      </div>
      <div className="flex-1 admin-card p-5 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`h-12 w-2/3 bg-muted rounded-xl ${i % 2 === 0 ? '' : 'ml-auto'}`} />
        ))}
      </div>
    </div>
  );
}
