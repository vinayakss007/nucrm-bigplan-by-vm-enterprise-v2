export default function Loading() {
  return (
    <div className="animate-pulse w-full space-y-4">
      <div className="h-7 w-48 bg-muted rounded" />
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 w-24 bg-muted rounded" />
        ))}
      </div>
      <div className="h-[300px] bg-muted rounded-lg" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded-lg" />
        ))}
      </div>
    </div>
  );
}
