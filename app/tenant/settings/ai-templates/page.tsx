'use client';
import { FileEdit } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AITemplatesPage() {
  return (
    <AIComingSoon
      icon={FileEdit}
      title="Auto-Draft Templates"
      blurb="Reusable AI prompts the team picks from when drafting. Define tone, structure, signature, length cap. Users edit the output before sending."
      capabilities={[
        'Per-scope templates (deal follow-up, lead first-touch, ticket reply)',
        'Tone presets (formal, friendly, concise, urgent)',
        'Variable injection — {{contact.first_name}}, {{deal.title}}, {{owner.name}}',
        'A/B testing acceptance rate per template',
      ]}
      depends_on={[
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
        { label: 'Picklists (deal types, sources)', href: '/tenant/settings/picklists', ready: true },
      ]}
      cta={{ label: 'Set up AI Providers first', href: '/tenant/settings/ai-providers' }}
    />
  );
}
