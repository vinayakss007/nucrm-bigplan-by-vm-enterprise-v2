export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-pulse">
      <div className="h-12 bg-muted rounded-2xl" />
      <div className="h-8 w-64 bg-muted rounded-xl" />
      <div className="space-y-3">
        {[...Array(3)].map((_,i) => (
          <div key={i} className="admin-card p-4 space-y-2">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-12 bg-muted rounded-lg" />
            <div className="h-12 bg-muted rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
