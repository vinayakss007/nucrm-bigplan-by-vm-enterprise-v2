export default function Loading() {
  return (
    <div className="animate-pulse w-full space-y-4">
      <div className="h-7 w-48 bg-muted rounded" />
      <div className="admin-card p-5 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded-xl" />
        ))}
      </div>
    </div>
  );
}
