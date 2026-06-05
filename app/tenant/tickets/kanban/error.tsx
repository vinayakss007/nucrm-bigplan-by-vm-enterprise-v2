'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-4">
      <p className="text-destructive font-medium">Failed to load ticket board</p>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700">
        Retry
      </button>
    </div>
  );
}
