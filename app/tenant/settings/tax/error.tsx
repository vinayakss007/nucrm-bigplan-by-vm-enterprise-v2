'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Something went wrong</h2>
        <p className="mt-1 text-sm text-red-600 dark:text-red-300">{error.message || 'Failed to load tax settings.'}</p>
        <button
          onClick={reset}
          className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
