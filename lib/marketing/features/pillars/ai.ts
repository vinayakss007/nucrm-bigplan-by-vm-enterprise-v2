/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const aiPillar: Pillar = {
  slug: 'ai',
  name: 'AI assistant',
  short: 'AI',
  icon: 'Sparkles',
  accent: 'from-sky-400 to-blue-600',
  eyebrow: 'AI assistant',
  headline: 'AI that does the admin, not the talking',
  sub: 'It drafts the follow-up, scores the lead, summarises the thread and tells you which account is quietly leaving.',
  blurb: 'Drafting, scoring, summarisation, sentiment and churn risk — with per-workspace usage budgets.',
  highlights: [
    { title: 'Drafts in your voice', desc: 'Generate follow-ups and replies from the actual record context, with a tone you choose. You approve before anything sends.', icon: 'PenLine' },
    { title: 'Scoring with reasons', desc: 'Leads scored 0–100 against your own rules plus behavioural signals, refreshed on a schedule.', icon: 'Target' },
    { title: 'Churn radar', desc: 'At-risk detection watches engagement decay and flags accounts before renewal, with rules you control.', icon: 'AlertTriangle' },
    { title: 'Read less, know more', desc: 'One-click summaries of a contact, a deal or a ticket thread — including sentiment across the conversation.', icon: 'FileText' },
  ],
  capabilities: [
    {
      heading: 'What the assistant does',
      items: [
        'Email drafting from record context, with tone and language control',
        'Content generation for templates, knowledge-base articles and campaign copy',
        'Summarisation of contacts, deals and ticket threads',
        'Sentiment analysis across inbound customer messages',
        'Lead scoring and lead warming with reply-intent classification',
        'At-risk and churn detection with configurable rules',
        'Activity insights that recommend the next best action',
        'Auto follow-up drafting on a schedule you set',
      ],
    },
    {
      heading: 'On your terms',
      items: [
        'Bring your own provider key, or use the platform allowance',
        'Per-workspace AI credit budgets with usage logs by user and feature',
        'Prompt templates managed by admins so output stays on-brand',
        'Nothing sends automatically unless you explicitly enable it',
        'Every AI action written to the audit trail',
      ],
    },
    {
      heading: 'Where it shows up',
      items: [
        'Inside the email composer and reply box',
        'On contact, lead, deal and ticket detail pages',
        'In the lead-warming and follow-up automation engines',
        'As a dedicated AI workspace for drafting, summarising and analysis',
      ],
    },
  ],
  outcomes: [
    'Follow-ups go out same-day instead of next-week',
    'Reps spend their time on the top of the list, not the middle',
    'Renewal risk surfaces a quarter early',
  ],
  related: ['automation', 'conversations', 'sales-pipeline'],
};
