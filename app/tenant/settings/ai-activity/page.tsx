'use client';
import { Activity } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AIActivityLogPage() {
  return (
    <AIComingSoon
      icon={Activity}
      title="AI Activity Log"
      blurb="Auditable record of every AI invocation. Required for governance, billing transparency, and trust — your customers can see exactly what AI did."
      capabilities={[
        'Per-user, per-capability, per-provider breakdown',
        'Token spend with model-level cost mapping',
        'Acceptance rate (kept vs. discarded)',
        'CSV export for finance / DPA reviews',
        'Configurable retention (30/90/365 days)',
      ]}
      depends_on={[
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
      ]}
      cta={{ label: 'Connect AI Providers', href: '/tenant/settings/ai-providers' }}
    />
  );
}
