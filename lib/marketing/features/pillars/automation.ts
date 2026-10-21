/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const automationPillar: Pillar = {
  slug: 'automation',
  name: 'Automation',
  short: 'Automation',
  icon: 'Zap',
  accent: 'from-amber-400 to-orange-500',
  eyebrow: 'Automation',
  headline: 'Build the process once. It runs forever.',
  sub: 'A visual builder for multi-step workflows with conditions, delays and branching — plus drip sequences and event webhooks.',
  blurb: 'Visual workflow builder, drip sequences, assignment rules and reliable webhook delivery.',
  highlights: [
    { title: 'Visual builder', desc: 'Drag nodes, connect them, add conditions and delays. Read the whole process at a glance instead of decoding rule lists.', icon: 'GitBranch' },
    { title: 'Event triggers', desc: 'Fire on record created, stage changed, deal won, form submitted, ticket breached and dozens more.', icon: 'Zap' },
    { title: 'Sequences that behave', desc: 'Multi-step drip campaigns with personalisation, enrolment rules, per-step logs and automatic exit on reply.', icon: 'Mails' },
    { title: 'Delivery you can trust', desc: 'Outbound webhooks with exponential-backoff retries, delivery logs and a dead-letter queue you can replay.', icon: 'Webhook' },
  ],
  capabilities: [
    {
      heading: 'Workflow engine',
      items: [
        'Visual drag-and-drop builder with unlimited steps',
        'Conditional logic and branching on any field or computed value',
        'Delay and wait-until steps',
        'Actions: send email, send SMS or WhatsApp, create task, update field, assign owner, notify channel, call webhook',
        'Pre-built one-click workflows for the common cases (welcome email, task reminders, stage alerts, trial expiry)',
      ],
    },
    {
      heading: 'Sequences & touchpoints',
      items: [
        'Drip email sequences with template variables and step-level analytics',
        'Enrolment from segments, forms, imports or workflow actions',
        'Lead warming: birthday, anniversary and festival touchpoints across 20+ events',
        'Reply-intent detection that converts positive replies into follow-up tasks',
        'Contact cooldown and rate limiting so nobody gets over-messaged',
      ],
    },
    {
      heading: 'Routing & integration',
      items: [
        'Assignment rules with round-robin and load balancing',
        'Approval requests for discounts, quotes and contracts',
        'Inbound webhooks to let external systems drive CRM changes',
        'Scheduled jobs for scoring, warming, at-risk detection and report delivery',
        'Full execution logs for every automation run',
      ],
    },
  ],
  outcomes: [
    'Hand-offs stop depending on someone remembering',
    'New reps inherit the process instead of learning it',
    'Integrations fail loudly and recover automatically',
  ],
  related: ['ai', 'conversations', 'platform'],
};
