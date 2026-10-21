/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const supportPillar: Pillar = {
  slug: 'support',
  name: 'Support desk',
  short: 'Support',
  icon: 'LifeBuoy',
  accent: 'from-rose-400 to-pink-500',
  eyebrow: 'Support desk',
  headline: 'Support that can see the sales history',
  sub: 'A full ticketing desk with SLA timers, satisfaction surveys and a public knowledge base — sharing one customer record with sales.',
  blurb: 'Tickets, SLA policies, CSAT, knowledge base and a branded customer portal.',
  highlights: [
    { title: 'Tickets with context', desc: 'Every ticket shows the customer’s deals, invoices and past conversations. No "let me look you up".', icon: 'Ticket' },
    { title: 'SLA timers', desc: 'First-response and resolution targets per priority, with breach warnings and escalation.', icon: 'Timer' },
    { title: 'Ask how it went', desc: 'Automatic CSAT surveys on resolution, answered on a public link, scored and reported.', icon: 'Smile' },
    { title: 'Self-service that works', desc: 'A categorised, searchable knowledge base your customers can use — and your agents can insert into replies.', icon: 'BookOpen' },
  ],
  capabilities: [
    {
      heading: 'Desk',
      items: [
        'Ticket queue with kanban and table views',
        'Status workflow, priorities, tags and assignment to agents or teams',
        'Public replies plus internal notes on the same thread',
        'Canned responses and knowledge-base article insertion',
        'SLA policies per priority with breach alerting',
        'Sentiment analysis and AI summarisation on long threads',
      ],
    },
    {
      heading: 'Customer portal',
      items: [
        'Branded self-service portal per workspace',
        'Customers raise and track their own tickets',
        'Knowledge base with categories and search',
        'Invoice and quote access',
        'Account details and contact preferences',
      ],
    },
    {
      heading: 'Quality',
      items: [
        'CSAT surveys delivered on a public token link',
        'Satisfaction reporting by agent, team and period',
        'Response and resolution time analytics',
        'Escalation and approval routing for sensitive cases',
      ],
    },
  ],
  outcomes: [
    'Customers stop repeating themselves',
    'Breaches get caught before the customer notices',
    'Support becomes an input to retention, not a cost centre',
  ],
  related: ['conversations', 'analytics', 'quote-to-cash'],
};
