/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import { Home, ArrowLeft } from 'lucide-react';

export default function TenantNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-6xl font-bold text-muted-foreground/20 select-none">404</p>
      <h1 className="text-xl font-bold mt-3 mb-1">Page not found</h1>
      <p className="text-sm text-muted-foreground mb-6">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
      <div className="flex items-center gap-3">
        <Link href="/tenant/dashboard" className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
          <Home className="w-4 h-4" />Dashboard
        </Link>
        <button onClick={() => window.history.back()} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
          <ArrowLeft className="w-4 h-4" />Go back
        </button>
      </div>
    </div>
  );
}
