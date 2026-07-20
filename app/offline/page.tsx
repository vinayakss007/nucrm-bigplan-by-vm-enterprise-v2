import { WifiOff } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        <WifiOff className="w-12 h-12 text-muted-foreground/30 mx-auto" />
        <h1 className="text-lg font-bold">You&apos;re offline</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Please check your internet connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
