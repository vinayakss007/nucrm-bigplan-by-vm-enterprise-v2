/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const analyticsPillar: Pillar = {
  slug: 'analytics',
  name: 'Analytics',
  short: 'Analytics',
  icon: 'BarChart3',
  accent: 'from-indigo-400 to-blue-500',
  eyebrow: 'Analytics',
  headline: 'Answers, not exports',
  sub: 'Build the report once, put it on a dashboard, and have it in your inbox every Monday morning.',
  blurb: 'Custom report builder, dashboards, forecasting and scheduled delivery.',
  highlights: [
    { title: 'Report builder', desc: 'Choose the entity, filters, grouping and columns. Save it, share it, schedule it. No analyst required.', icon: 'Table2' },
    { title: 'Dashboards you arrange', desc: 'Widget grid you lay out yourself, with templates to start from and per-role visibility.', icon: 'LayoutDashboard' },
    { title: 'Forecast and funnel', desc: 'Weighted pipeline forecasting, conversion funnels and velocity by stage, owner or source.', icon: 'TrendingUp' },
    { title: 'Delivered on schedule', desc: 'Reports emailed daily, weekly or monthly as CSV to whoever needs them.', icon: 'CalendarClock' },
  ],
  capabilities: [
    {
      heading: 'Build',
      items: [
        'Custom report builder across contacts, leads, deals, tickets, invoices and activities',
        'Saved reports with sharing and permissions',
        'Calculated fields via a formula engine, usable in reports',
        'Segment builder for dynamic lists that feed campaigns',
        'Data explorer for ad-hoc questions',
      ],
    },
    {
      heading: 'Watch',
      items: [
        'Configurable dashboard widget grid with layout templates',
        'Pipeline value, revenue to date, tasks due, activity feed and closing deals widgets',
        'Team performance and leaderboard reporting',
        'Email engagement analytics: sends, opens, clicks by campaign and template',
        'Form conversion analytics and visitor page-view reporting',
      ],
    },
    {
      heading: 'Share',
      items: [
        'Scheduled report delivery with execution history',
        'CSV export on any report',
        'Exportable data for your own warehouse or BI tool',
        'Per-role dashboard visibility so people see their own numbers',
      ],
    },
  ],
  outcomes: [
    'Weekly reporting stops being a manual ritual',
    'Everyone argues from the same numbers',
    'Bottlenecks are visible while they are still fixable',
  ],
  related: ['sales-pipeline', 'quote-to-cash', 'platform'],
};
