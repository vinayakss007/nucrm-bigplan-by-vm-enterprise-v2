/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const platformPillar: Pillar = {
  slug: 'platform',
  name: 'Platform & governance',
  short: 'Platform',
  icon: 'ShieldCheck',
  accent: 'from-slate-300 to-slate-500',
  eyebrow: 'Platform & governance',
  headline: 'Built for the person who has to sign off on it',
  sub: 'Isolated workspaces, granular permissions, custom fields, audit trails and recovery — the parts that decide whether a CRM survives an audit.',
  blurb: 'Multi-workspace isolation, RBAC, custom objects and fields, audit trails and backups.',
  highlights: [
    { title: 'Real workspace isolation', desc: 'Every workspace’s data is separated at the storage layer, not just filtered in the interface. Agencies and groups run many brands from one login.', icon: 'Layers' },
    { title: 'Permissions to the field', desc: 'Roles, custom roles, record-level access and field-level visibility, plus a team hierarchy that respects reporting lines.', icon: 'KeyRound' },
    { title: 'Shape it to your business', desc: 'Custom fields, custom picklists, custom pipelines, industry blueprints and calculated fields — no developer needed.', icon: 'SlidersHorizontal' },
    { title: 'Prove what happened', desc: 'Full audit trail, field-level change history, session management and impersonation logging.', icon: 'ScrollText' },
  ],
  capabilities: [
    {
      heading: 'Workspaces & access',
      items: [
        'Multi-workspace architecture with isolation enforced at the data layer',
        'Built-in roles (admin, manager, sales rep, viewer) plus unlimited custom roles',
        'Granular permission matrix per module and action',
        'Record-level and field-level permission rules',
        'Team hierarchy, territories and out-of-office delegation',
        'Per-workspace branding: logo, colours and custom domain',
      ],
    },
    {
      heading: 'Configuration',
      items: [
        'Custom fields across every entity with multiple types',
        'Custom pipelines, stages, picklists and tags',
        '13 industry blueprints that install fields, pipelines and automations in one click',
        'Localisation and language switching',
        'Per-user preferences for density, font size, accent colour and motion',
        'CSV import/export and full workspace data export',
      ],
    },
    {
      heading: 'Assurance',
      items: [
        'Immutable audit log for tenant and administrator actions',
        'Field-level edit history with before/after values',
        'Active session listing and remote revocation',
        'Automated backups with point-in-time and selective restore',
        'Soft delete with recoverable trash and retention policies',
        'Usage metering per workspace: records, storage, API calls and AI credits',
      ],
    },
  ],
  outcomes: [
    'Security review stops being the blocker',
    'One account can run many brands cleanly',
    'Mistakes are recoverable instead of terminal',
  ],
  related: ['analytics', 'automation', 'sales-pipeline'],
};
