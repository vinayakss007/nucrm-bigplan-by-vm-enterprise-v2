'use client';
import { Activity } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AIActivityPage() {
  return (
    <AIComingSoon
      icon={Activity}
      title="AI Activity Log"
      blurb="Full audit of every AI invocation across the workspace. Who did what, which model answered, how many tokens, what it cost, and what the user did with the output."
      capabilities={[
        'Filter by user, capability, provider or date range',
        'Token spend per provider with running totals',
        'Acceptance rate (suggestions kept vs. discarded)',
        'Export to CSV for finance / governance reviews',
      ]}
      depends_on={[
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
      ]}
      cta={{ label: 'Connect a provider', href: '/tenant/settings/ai-providers' }}
    />
  );
}
