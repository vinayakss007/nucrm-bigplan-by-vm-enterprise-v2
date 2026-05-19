'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, Home, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
        </div>
        <div className="mb-6">
          <p className="text-8xl font-bold text-violet-200 dark:text-violet-900 select-none">404</p>
          <h1 className="text-2xl font-bold mt-2 mb-2">Page not found</h1>
          <p className="text-muted-foreground text-sm">The page you're looking for doesn't exist or has been moved.</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Link href="/tenant/dashboard" className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors shadow-lg shadow-violet-500/20">
            <Home className="w-4 h-4" />Go to Dashboard
          </Link>
          <button onClick={() => router.back()} className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
            <ArrowLeft className="w-4 h-4" />Go back
          </button>
        </div>
      </div>
    </div>
  );
}
