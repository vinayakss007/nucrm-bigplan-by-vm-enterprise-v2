/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The landing page's product tour, as data (#3429).
 *
 * Eighty-odd lines of tab copy sat inside `app/(marketing)/page.tsx` next to
 * the `<ProductTour tabs={TOUR} />` that consumed it. The component owns the
 * interaction; the tabs are content, so they live with the rest of the
 * marketing corpus and the page keeps the one line that mounts it.
 */
import type { TourTab } from '@/components/marketing/product-tour';

export const HOME_TOUR: TourTab[] = [
  {
    id: 'ai',
    label: 'AI',
    icon: 'Sparkles',
    accent: 'from-sky-400 to-blue-600',
    title: 'It writes the follow-up you keep postponing',
    body: 'The assistant reads the record — every email, call note, ticket and deal change — then drafts the next message in the tone you picked. Nothing sends without your approval.',
    points: [
      'Drafts built from real record context, not a blank template',
      'Lead scores and churn risk with the signals that produced them',
      'One-click summaries of a long thread before you jump on a call',
      'Bring your own provider key, with per-workspace credit budgets',
    ],
    href: '/features/ai',
    visual: 'ai',
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: 'Zap',
    accent: 'from-amber-400 to-orange-500',
    title: 'Draw the process once, then stop thinking about it',
    body: 'A visual builder with real branching, conditions and delays. Deal marked won? Notify the channel, generate the invoice, create the onboarding tasks, all in the order you drew.',
    points: [
      'Conditions and branches on any field or computed value',
      'Sequences that exit automatically when someone replies',
      'Assignment rules with round-robin and load balancing',
      'Outbound events retry, log, and land in a queue you can replay',
    ],
    href: '/features/automation',
    visual: 'automation',
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'MessageSquare',
    accent: 'from-emerald-400 to-teal-500',
    title: 'Email, WhatsApp, SMS, chat and calls — one thread',
    body: 'Every message a customer ever sent, on the record it belongs to, whichever channel it arrived on. Support and sales finally read the same history.',
    points: [
      'Templates with merge fields across every channel',
      'Open and click tracking rolled into lead scoring',
      'Sending-domain warmup so volume outreach stays deliverable',
      'Embeddable forms and chat that create records instantly',
    ],
    href: '/features/conversations',
    visual: 'conversations',
  },
  {
    id: 'revenue',
    label: 'Quote to cash',
    icon: 'Receipt',
    accent: 'from-cyan-400 to-blue-500',
    title: 'From “send me a quote” to money in the bank',
    body: 'Build the quote from your catalogue, send it as a public link, watch it get opened, collect the signature, raise the invoice — without leaving the deal.',
    points: [
      'Branded quote and invoice PDFs with tax and multi-currency',
      'Public accept and decline links, no customer login needed',
      'E-signature with a full signing event log',
      'Contracts, subscriptions and renewal reminders',
    ],
    href: '/features/revenue',
    visual: 'revenue',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: 'BarChart3',
    accent: 'from-blue-400 to-cyan-500',
    title: 'Build the report once. Read it every Monday.',
    body: 'Pick the entity, the filters and the grouping. Save it, drop it on a dashboard, schedule it. Weekly reporting stops being a manual ritual.',
    points: [
      'Custom reports across every entity in the product',
      'Dashboards you arrange, with per-role visibility',
      'Weighted forecasting and conversion funnels',
      'Delivered as PDF or CSV on a schedule you set',
    ],
    href: '/features/analytics',
    visual: 'analytics',
  },
];
