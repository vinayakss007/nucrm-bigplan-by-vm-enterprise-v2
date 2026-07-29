export default function Loading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-8 bg-muted rounded w-48 mb-4" />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
