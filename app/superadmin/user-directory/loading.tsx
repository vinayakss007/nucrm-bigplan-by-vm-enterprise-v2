export default function Loading() {
  return (
    <div className="space-y-5 max-w-6xl animate-pulse">
      <div className="h-8 w-48 bg-white/10 rounded-lg" />
      <div className="h-10 w-72 bg-white/10 rounded-xl" />
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-12 bg-white/5 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
