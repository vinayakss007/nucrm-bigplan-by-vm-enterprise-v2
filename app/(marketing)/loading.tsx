/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Marketing-site loading state (#1840). Matches the dark marketing surface so
 * navigations don't flash the app shell's light skeleton.
 */
export default function MarketingLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950" role="status" aria-label="Loading">
      <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-sky-400 animate-spin" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
