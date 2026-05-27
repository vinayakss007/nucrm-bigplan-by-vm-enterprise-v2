'use client';
import { FileEdit, Sparkles, AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import AIComingSoon from '@/components/tenant/ai/ai-coming-soon';

export default function AIDraftPage() {
  return (
    <AIComingSoon
      icon={FileEdit}
      title="Auto-Draft"
      blurb="Pick a contact, deal or ticket — AI writes the next message in your tone, with the context it already knows. You edit before sending. Never one-click-spam."
      capabilities={[
        'Draft follow-up email after a meeting',
        'Reply to a stalled deal thread',
        'Compose a personalised outbound message',
        'Generate call-prep notes',
        'Summarise a thread before replying',
      ]}
      depends_on={[
        { label: 'Email integration', href: '/tenant/settings/email', ready: false },
        { label: 'AI Providers', href: '/tenant/settings/ai-providers', ready: false },
        { label: 'Auto-Draft Templates', href: '/tenant/settings/ai-templates', ready: false },
      ]}
      cta={{
        label: 'Configure templates',
        href: '/tenant/settings/ai-templates',
      }}
    />
  );
}
