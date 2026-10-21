/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const salesPipelinePillar: Pillar = {
  slug: 'sales-pipeline',
  name: 'Sales & pipeline',
  short: 'Sales',
  icon: 'TrendingUp',
  accent: 'from-blue-500 to-indigo-500',
  eyebrow: 'Sales & pipeline',
  headline: 'Every deal, every stage, one screen',
  sub: 'Leads come in, get scored, get assigned and get worked — without anyone maintaining a spreadsheet on the side.',
  blurb: 'Drag-and-drop pipelines, lead scoring, assignment rules and forecasting that reflects reality.',
  highlights: [
    { title: 'Drag-and-drop pipelines', desc: 'Move deals between stages and watch stage totals, weighted value and forecast update as you drop.', icon: 'Kanban' },
    { title: 'Lead scoring that explains itself', desc: 'Rule-based BANT scoring blended with model-driven signals, so reps see why a lead is hot — not just a number.', icon: 'Gauge' },
    { title: 'Automatic assignment', desc: 'Round-robin, load-balanced or rule-based routing by territory, source, value or custom field.', icon: 'Shuffle' },
    { title: 'Nothing falls through', desc: 'Follow-up scheduling with missed follow-up detection, so silence gets surfaced instead of forgotten.', icon: 'BellRing' },
  ],
  capabilities: [
    {
      heading: 'Records that hold the whole story',
      items: [
        'Contacts with lifecycle stages, tags, timeline and full communication history',
        'Companies with industry, size, revenue, linked contacts and parent/child hierarchy',
        'Duplicate detection with merge suggestions and merge-safe history',
        'Leads with source attribution, scoring and a conversion path into contacts and deals',
        'Per-record notes, file attachments and change history with field-level diffs',
      ],
    },
    {
      heading: 'Pipeline & forecasting',
      items: [
        'Unlimited pipelines with custom stages per pipeline',
        'Kanban board and table views for deals, tasks and tickets',
        'Stage-entry automation: create tasks, send email, notify a channel, update fields',
        'Multi-currency deals with live exchange-rate conversion',
        'Weighted forecasting, revenue projections and opportunity roll-ups',
      ],
    },
    {
      heading: 'How reps actually work',
      items: [
        'Command palette for jump-to-anything and quick actions',
        'Inline editing on any list — click the cell, change the value, move on',
        'Bulk edit, assign, tag and delete across selections',
        'Saved views with filters, sorting and column choices per user',
        'Advanced search across every entity, plus a data explorer for ad-hoc questions',
        'Ten-second undo on destructive actions and a recoverable trash',
        'Territories, team hierarchy, leaderboards and out-of-office handoff',
      ],
    },
  ],
  outcomes: [
    'Reps stop maintaining a private spreadsheet',
    'Managers get a forecast they can defend',
    'Leads get worked in minutes, not days',
  ],
  related: ['ai', 'automation', 'analytics'],
};
