'use client';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8 max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-violet-600/10 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L15.536 15.536m0 0a9 9 0 01-12.728 0m12.728 0l-2.829-2.829M8.464 5.636a9 9 0 000 12.728m0 0l2.829-2.829m-2.829 2.829L11.293 15.536" />
          </svg>
        </div>
        <h1 className="text-xl font-bold">You are offline</h1>
        <p className="text-sm text-muted-foreground">
          Check your internet connection and try again. Some cached pages may still be available.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
        >
          Retry Connection
        </button>
      </div>
    </div>
  );
}
