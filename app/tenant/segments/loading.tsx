export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between"><div className="h-7 w-36 bg-muted rounded-xl" /><div className="h-9 w-32 bg-muted rounded-xl" /></div>
      <div className="admin-card divide-y divide-border">
        {[...Array(4)].map((_, i) => (<div key={i} className="flex items-center gap-4 px-5 py-3.5"><div className="flex-1 space-y-1.5"><div className="h-4 w-40 bg-muted rounded" /><div className="h-3 w-28 bg-muted rounded" /></div></div>))}
      </div>
    </div>
  );
}
