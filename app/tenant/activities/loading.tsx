export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 max-w-4xl mx-auto">
      <div className="h-7 w-40 bg-muted rounded-xl" />
      <div className="admin-card divide-y divide-border">
        {[...Array(8)].map((_, i) => (<div key={i} className="flex items-start gap-3 px-5 py-3"><div className="w-2 h-2 bg-muted rounded-full mt-2" /><div className="flex-1 space-y-1"><div className="h-4 w-64 bg-muted rounded" /><div className="h-3 w-32 bg-muted rounded" /></div></div>))}
      </div>
    </div>
  );
}
