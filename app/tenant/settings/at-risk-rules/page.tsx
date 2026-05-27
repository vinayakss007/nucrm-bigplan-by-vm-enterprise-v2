'use client';
import { AlertTriangle } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AtRiskRulesPage() {
  return (
    <AIComingSoon
      icon={AlertTriangle}
      title="At-Risk Detection Rules"
      blurb="Tell NuCRM what 'at risk' means in your sales motion. Combine hard rules with AI signal detection."
      capabilities={[
        'Days-since-activity threshold per stage',
        'Time-in-stage limit (e.g. 30 days in Negotiation = at-risk)',
        'Sentiment-shift detection on latest reply',
        'Manager-only override list',
        'Daily digest emailed to managers',
      ]}
      depends_on={[
        { label: 'Pipelines + Stages', href: '/tenant/settings/pipelines', ready: true },
        { label: 'Activity history', href: '/tenant/deals', ready: true },
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
      ]}
      cta={{ label: 'Pipelines configured', href: '/tenant/settings/pipelines' }}
    />
  );
}
