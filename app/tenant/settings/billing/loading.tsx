export default function Loading() {
  return (
    <div className="animate-pulse max-w-2xl space-y-4">
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="admin-card p-5 space-y-4">
        {[...Array(4)].map((_,i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-10 bg-muted rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
