/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Security, compliance and reliability content.
 *
 * Only describe controls that exist in the product today. Where something is a
 * commitment rather than a shipped control (for example an external audit
 * report), say so plainly — security pages are read by people whose job is to
 * catch overstatement.
 */

export const SECURITY_PILLARS = [
  {
    title: 'Isolation you can point at',
    icon: 'Layers',
    accent: 'from-blue-500 to-indigo-500',
    body: 'Every workspace is separated at the data layer, not merely filtered in the interface. A query that forgets a workspace filter returns nothing rather than someone else’s customers.',
    points: [
      'Workspace isolation enforced beneath the application',
      'Separate users, roles, branding and domain per workspace',
      'Administrator impersonation is explicit, time-bound and logged',
      'Usage and limits metered per workspace',
    ],
  },
  {
    title: 'Access, controlled properly',
    icon: 'KeyRound',
    accent: 'from-cyan-400 to-blue-500',
    body: 'Permissions go past "admin or not". Roles, records and individual fields can each be restricted, and the team hierarchy respects who reports to whom.',
    points: [
      'Built-in and unlimited custom roles',
      'Record-level and field-level permission rules',
      'Single sign-on with SAML and OpenID Connect',
      'Two-factor authentication and configurable login policies',
      'IP allow-listing and brute-force protection',
      'Active session listing with remote revocation',
    ],
  },
  {
    title: 'Data protection',
    icon: 'Lock',
    accent: 'from-emerald-400 to-teal-500',
    body: 'Sensitive values are encrypted at the field level on top of encryption at rest, and every input is sanitised before it is stored or rendered.',
    points: [
      'Field-level encryption for sensitive attributes',
      'Encryption at rest and in transit',
      'Data-loss-prevention policies with monitoring',
      'Input sanitisation against injection and script attacks',
      'Anti-forgery protection on every state-changing request',
      'Tiered rate limiting across the API surface',
    ],
  },
  {
    title: 'Provable history',
    icon: 'ScrollText',
    accent: 'from-amber-400 to-orange-500',
    body: 'When someone asks who changed the deal value in March, the answer takes seconds — including what it was before.',
    points: [
      'Immutable audit log for workspace and administrator actions',
      'Field-level change history with before and after values',
      'Security event tracking with alerting',
      'Error and access monitoring with retention',
      'Exportable audit evidence for reviewers',
    ],
  },
] as const;

export const COMPLIANCE_ITEMS = [
  {
    title: 'GDPR',
    icon: 'Scale',
    body: 'Data subject access requests, right to erasure and data portability are handled as product features, not support tickets. Retention policies expire data on a schedule you define.',
    points: ['Subject access request workflow', 'Right to deletion with dependency handling', 'Structured data export for portability', 'Configurable retention and auto-cleanup', 'Processing records and audit evidence'],
  },
  {
    title: 'SOC 2 aligned controls',
    icon: 'ClipboardCheck',
    body: 'The control set the SOC 2 trust criteria expect is implemented in the product: access control, audit logging, change history, monitoring and backup. Ask us for the current status of external attestation.',
    points: ['Role-based access control', 'Comprehensive audit trails', 'Change and configuration history', 'Continuous monitoring and alerting', 'Tested backup and restore procedures'],
  },
  {
    title: 'Data residency and deployment',
    icon: 'Globe',
    body: 'Cloud by default. Enterprise agreements can specify a private deployment or a particular region where your workspace data lives.',
    points: ['Regional hosting options on Enterprise', 'Private deployment available', 'Documented sub-processor list on request', 'Data processing agreement available'],
  },
] as const;

export const RELIABILITY_ITEMS = [
  {
    title: 'Backups that have been restored',
    icon: 'DatabaseBackup',
    body: 'Automated backups on a schedule, with point-in-time restore and selective restore when you only need one record set back — not the whole workspace.',
  },
  {
    title: 'Nothing is deleted immediately',
    icon: 'Trash2',
    body: 'Deletes are soft by default. Records go to a recoverable trash with restore, and destructive actions carry a ten-second undo.',
  },
  {
    title: 'Integrations fail safely',
    icon: 'RefreshCw',
    body: 'Outbound deliveries retry with exponential backoff and land in a dead-letter queue you can inspect and replay, so a partner outage never silently loses events.',
  },
  {
    title: 'Watched continuously',
    icon: 'Activity',
    body: 'Health checks, error tracking, performance monitoring and rate-limit visibility, with alerting on the signals that matter.',
  },
  {
    title: 'Works when the network does not',
    icon: 'WifiOff',
    body: 'Installable on desktop and mobile, offline-capable for reading, with graceful reconnection and queued actions.',
  },
  {
    title: 'Service commitments',
    icon: 'FileCheck',
    body: 'Enterprise agreements carry a contractual service-level agreement, a named contact and an incident communication process.',
  },
] as const;

export const SECURITY_FAQ = [
  {
    q: 'Who can see my workspace data?',
    a: 'Only the users you invite. Support staff cannot browse your records; assisting with an issue requires an explicit, time-bound impersonation session that is written to the audit log and visible to your administrators.',
  },
  {
    q: 'Can I get my data out?',
    a: 'Yes, at any time, without asking us. Export by entity as CSV or take a full structured workspace export, and pull anything over the documented API.',
  },
  {
    q: 'What happens if we cancel?',
    a: 'Your data stays available for export throughout a defined retention window after cancellation, then is deleted according to the retention policy in your agreement.',
  },
  {
    q: 'Do you train AI models on our data?',
    a: 'No. Assistant features send only the context needed for the specific request, and you can supply your own provider key so calls never touch our allowance at all. AI usage is logged per workspace.',
  },
  {
    q: 'Can we host it ourselves?',
    a: 'Private deployment is available under an Enterprise agreement. Talk to us about region, network and operational requirements.',
  },
  {
    q: 'How do you handle a vulnerability report?',
    a: 'Email the security address in your agreement, or contact us through the site. We acknowledge reports quickly, keep you updated through triage and remediation, and credit reporters who ask to be credited.',
  },
] as const;
