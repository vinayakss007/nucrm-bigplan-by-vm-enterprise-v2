'use client';
import { AlertTriangle } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AIAtRiskPage() {
  return (
    <AIComingSoon
      icon={AlertTriangle}
      title="At-Risk Deals"
      blurb="Catch stalled pipeline before quarter-end. Combines stage stagnation, activity gaps, sentiment in recent emails, and historical win/loss patterns."
      capabilities={[
        'Flag deals stuck in a stage past expected duration',
        'Detect sentiment shifts in latest email reply',
        'Score how likely a stalled deal still closes',
        'Daily digest for managers on the at-risk list',
      ]}
      depends_on={[
        { label: 'Deals + Pipeline stages', href: '/tenant/settings/pipelines', ready: true },
        { label: 'Activity history', href: '/tenant/deals', ready: true },
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
        { label: 'At-Risk Detection rules', href: '/tenant/settings/at-risk-rules', ready: false },
      ]}
      cta={{ label: 'Tune detection thresholds', href: '/tenant/settings/at-risk-rules' }}
    />
  );
}
