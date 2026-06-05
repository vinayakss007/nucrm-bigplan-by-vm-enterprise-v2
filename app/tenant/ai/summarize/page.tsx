'use client';
import { MessageSquare } from 'lucide-react';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AISummarizePage() {
  return (
    <AIComingSoon
      icon={MessageSquare}
      title="Summarize"
      blurb="A button on every record that gives you the TL;DR — last interaction, current status, what to do next."
      capabilities={[
        'TL;DR for any contact, company, deal or ticket',
        'Manager-style "what changed this week" digest',
        'Auto-generate close notes from full thread history',
        'Pre-meeting briefs from CRM history + calendar',
      ]}
      depends_on={[
        { label: 'Activities + Notes', href: '/tenant/contacts', ready: true },
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
      ]}
      cta={{ label: 'Connect AI provider', href: '/tenant/settings/ai-providers' }}
    />
  );
}
