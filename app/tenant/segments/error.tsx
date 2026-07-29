'use client';

export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6 text-center">
      <h2 className="text-lg font-semibold text-destructive mb-2">Failed to load segments</h2>
      <p className="text-muted-foreground mb-4">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
        Try again
      </button>
    </div>
  );
}
