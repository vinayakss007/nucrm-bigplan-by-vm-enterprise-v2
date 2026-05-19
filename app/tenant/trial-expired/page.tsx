import Link from 'next/link';
import { Zap, Crown, ArrowUpRight } from 'lucide-react';

export default function TrialExpiredPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="text-center max-w-lg">
        <div className="inline-flex items-center gap-2.5 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-3xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
        </div>
        <div className="w-16 h-16 bg-amber-100 dark:bg-amber-950/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <Crown className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold mb-3">Your free trial has ended</h1>
        <p className="text-muted-foreground mb-8">
          Your trial period has expired. Upgrade to a paid plan to continue using NuCRM and keep all your data.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/tenant/settings/billing"
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold shadow-lg shadow-violet-500/25 transition-colors">
            <Crown className="w-4 h-4" />View Plans & Upgrade <ArrowUpRight className="w-4 h-4" />
          </Link>
          <Link href="/tenant/dashboard" className="px-6 py-3 rounded-xl border border-border hover:bg-accent font-medium transition-colors text-sm">
            Continue to Dashboard
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-6">
          Need help? <a href="mailto:support@nucrm.io" className="text-violet-600 hover:underline">Contact support</a>
        </p>
      </div>
    </div>
  );
}
