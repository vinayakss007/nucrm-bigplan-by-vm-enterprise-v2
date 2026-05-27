'use client';
import { Target } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function LeadScoringRulesPage() {
  return (
    <AIComingSoon
      icon={Target}
      title="Lead Scoring Rules"
      blurb="Hand-tuned weights or AI-trained model. Pick which signals matter, how much, and when to recompute."
      capabilities={[
        'Factor weights — source, company size, engagement count, role',
        'AI-augmented mode — let the gateway suggest weights from your wins',
        'Recompute schedule (real-time, hourly, nightly)',
        'Per-pipeline scoring profiles',
      ]}
      depends_on={[
        { label: 'Leads with activity history', href: '/tenant/leads', ready: true },
        { label: 'Picklists (lead sources)', href: '/tenant/settings/picklists', ready: true },
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
      ]}
      cta={{ label: 'Connect AI Providers', href: '/tenant/settings/ai-providers' }}
    />
  );
}
