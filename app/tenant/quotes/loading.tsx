export default function Loading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-8 bg-muted rounded w-48 mb-4" />
      <div className="h-10 bg-muted rounded w-full mb-4" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-12 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
