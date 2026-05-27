'use client';
import { Target } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AILeadScoringPage() {
  return (
    <AIComingSoon
      icon={Target}
      title="Lead Scoring"
      blurb="Predict which lead converts. Combines your historical wins/losses with live engagement signals. Reps see a ranked list; you see the why behind every score."
      capabilities={[
        'Re-rank the lead queue every hour',
        'Explain each score (top contributing factors)',
        'Suggest the next-best-action per lead',
        'Auto-promote hot leads to the right rep',
      ]}
      depends_on={[
        { label: 'Leads with activity history', href: '/tenant/leads', ready: true },
        { label: 'Picklists (sources / loss reasons)', href: '/tenant/settings/picklists', ready: true },
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
        { label: 'Lead Scoring Rules', href: '/tenant/settings/lead-scoring', ready: false },
      ]}
      cta={{ label: 'Edit scoring rules', href: '/tenant/settings/lead-scoring' }}
    />
  );
}
