# NuCRM Enterprise

**Multi-tenant Enterprise SaaS CRM** — Next.js 16, PostgreSQL, Drizzle ORM, TypeScript.  
Self-hosted with full plugin engine, workflow automation, AI-powered insights, and 215 database tables.

---

## Quick Start

```bash
git clone <repo-url>
cd nucrm-enterprise
cp .env.example .env.local   # Edit with your DB credentials
npm install
npm run db:sync              # Create all 215 tables
npm run dev                  # Start at localhost:3000
```

Then create the first admin:
```bash
curl -X POST http://localhost:3000/api/setup/create-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"AdminPass123!","full_name":"Admin","workspace_name":"Acme"}'
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | SSR, streaming, Turbopack |
| Language | TypeScript 5.9 | Strict mode, full type safety |
| Database | PostgreSQL 15+ | Drizzle ORM, JSONB, full-text search |
| ORM | Drizzle | Type-safe SQL, no hidden queries |
| Auth | JWT + httpOnly cookies | Stateless, XSS-safe |
| Queue | BullMQ (Redis) / PG-Boss | Background job processing |
| UI | Radix UI + Tailwind CSS | Accessible, customizable |
| Charts | Recharts | React-native charting |
| Tests | Vitest + Playwright | Fast, modern, E2E |
| Caching | Redis with in-memory fallback | Multi-tier cache |
| Email | Resend / SendGrid / Mailgun | Pluggable email providers |
| Storage | AWS S3 (presigned URLs) | Scalable file storage |
| Payments | Stripe | Subscriptions, billing, invoices |
| AI | OpenAI GPT / Claude | Drafts, summaries, scoring, sentiment |
| Monitoring | Sentry, Grafana, Prometheus | Error tracking, metrics, dashboards |
| Containerization | Docker + Docker Compose | Production-ready deployments |
| CI/CD | GitHub Actions | Lint, typecheck, tests, security scan, build |

---

## Architecture

```
src/
├── app/                          # Next.js App Router
│   ├── api/                      # ~290 API endpoints
│   │   ├── auth/                 # JWT, OAuth, SSO, 2FA, password reset
│   │   ├── tenant/               # All CRM operations (tenant-scoped)
│   │   ├── superadmin/           # Platform management
│   │   ├── public/               # Customer portal API
│   │   ├── cron/                 # Scheduled jobs (~15 cron endpoints)
│   │   ├── webhooks/             # Inbound webhooks (Stripe, WhatsApp, Resend)
│   │   ├── admin/                # Admin operations
│   │   ├── v2/                   # API v2 routes
│   │   ├── health/               # Health check endpoints
│   │   ├── track/                # Email tracking (click/open)
│   │   ├── embed/                # Embeddable form JS
│   │   └── setup/                # Initial setup
│   ├── tenant/                   # ~130 tenant-facing pages
│   ├── superadmin/               # ~27 admin pages
│   ├── portal/                   # 5 customer portal pages
│   └── auth/                     # 8 auth pages (login, signup, 2FA, etc.)
├── components/
│   ├── ui/                       # 25+ shared UI components (Radix-based)
│   ├── tenant/                   # 60+ tenant-specific components
│   ├── shared/                   # 20+ cross-cutting components
│   ├── superadmin/               # Super admin components
│   ├── branding/                 # Branding components
│   └── documents/                # Document components
├── lib/
│   ├── auth/                     # JWT, CSRF, sessions, OAuth, SSO, 2FA
│   ├── ai/                       # AI gateway, credits, drafts, scoring
│   ├── integrations/             # Plugin engine + providers (SendGrid, Slack, etc.)
│   ├── modules/                  # Module registry + SDK
│   ├── permissions/              # RBAC definitions
│   ├── cache/                    # Redis with memory fallback
│   ├── tenant/                   # Multi-tenant context
│   ├── db/                       # Database client and connection
│   ├── dashboard/                # Widget system + dashboard layouts
│   ├── webhooks/                 # Webhook delivery + DLQ
│   ├── email/                    # Email service (Resend, SMTP)
│   ├── security/                 # Encryption, IP whitelist, DLP
│   ├── compliance/               # GDPR, SOC2, data retention
│   ├── api/                      # API utilities
│   ├── i18n/                     # Internationalization
│   ├── queue/                    # BullMQ queue management
│   ├── rbac/                     # Role-based access control
│   ├── sdk/                      # Module SDK
│   ├── backup/                   # Backup & restore
│   ├── restore/                  # Selective restore
│   ├── usage/                    # Usage tracking & limits
│   ├── flags/                    # Feature flags
│   ├── audit/                    # Audit logging
│   ├── formula/                  # Calculated field engine
│   ├── react/                    # React utilities
│   ├── storage/                  # S3 file storage
│   ├── contacts/                 # Contact scoring & merge
│   ├── leads/                    # Lead scoring & warming
│   ├── lead-warming/             # Lead warming automation
│   ├── automation/               # Workflow automation logic
│   ├── plugins/                  # Plugin system
│   ├── products/                 # Product registry
│   ├── onboarding/               # Onboarding flows
│   └── export/                   # Data export
├── drizzle/
│   ├── schema/                   # 35 schema files, 215 tables
│   └── migrations/               # DDL + indexes + RLS policies
├── hooks/                        # Custom React hooks
├── types/                        # TypeScript type definitions
├── scripts/                      # ~25 dev/prod/utility scripts
├── deploy/                       # Docker, nginx, pgbouncer, postgres configs
├── monitoring/                   # Grafana, Prometheus configs
├── tests/
│   ├── unit/                     # ~85+ unit test files
│   ├── integration/              # ~9 integration test files
│   ├── e2e/                      # 6 Playwright E2E specs
│   └── dashboard/                # ~10 dashboard widget tests
└── docs/                         # Architecture, changelog, production readiness
```

---

## Database — 215 Tables

35 schema files across 13 domains, 9,045 lines of schema definitions, with full RLS (Row-Level Security) for tenant isolation.

### Schema Files

| File | Tables | Domain |
|---|---|---|
| `crm.ts` | 40 | Core CRM (contacts, companies, deals, leads, tasks, meetings, notes, tags) |
| `infra.ts` | 36 | Infrastructure (tenants, users, sessions, api keys, roles, permissions) |
| `automation.ts` | 19 | Workflows, sequences, automation rules, actions |
| `core.ts` | 17 | Core platform (plans, modules, features, settings, backup) |
| `comm.ts` | 15 | Communications (email, SMS, WhatsApp, notifications) |
| `tokens.ts` | 10 | Token system (AI tokens, budgets, limits) |
| `billing.ts` | 9 | Billing (invoices, subscriptions, plans, tax) |
| `ai.ts` | 7 | AI (insights, drafts, scoring, usage, providers) |
| `support.ts` | 5 | Support (tickets, ticket replies, SLA) |
| `lead-warming.ts` | 5 | Lead warming (campaigns, messages, replies, schedule) |
| `marketing.ts` | 4 | Marketing (forms, form submissions, segments) |
| `security.ts` | 3 | Security (events, compliance, impersonation) |
| `projects.ts` | 3 | Projects (projects, tasks, milestones) |
| `financial.ts` | 3 | Financial (exchange rates, cost anomalies, revenue projections) |
| 20 other files | 2 each | Visitors, usage, territories, templates, SMS, SLA, segments, plugins, modules, knowledge, history, hierarchy, eSignature, email-tracking, documents, compliance, chat, assignment, analytics-views, dashboard |
| `super-admin-audit.ts` | 1 | Super admin audit logs |
| `files.ts` | 1 | File uploads |
| `dashboard.ts` | 1 | Dashboard layouts |

### Complete Table List

<details>
<summary>Click to expand all 215 tables</summary>

**Core CRM:** activities, companies, contact_emails, contact_lifecycle_history, contact_merge_history, contact_scores, contact_tags, contacts, deals, deal_forecasts, deal_products, deal_stages, leads, lead_activities, lead_assignments, lead_offers, lead_scoring_rules, lead_tags, meetings, milestones, notes, tasks, tags, entity_tags, follow_ups

**Infrastructure:** tenants, tenant_hierarchy, tenant_members, tenant_modules, tenant_ai_credits, tenant_backup_records, tenant_backups, tenant_restore_records, tenant_restores, tenant_templates, tenant_token_limits, users, user_departures, user_token_limits, user_usage, sessions, api_keys, api_key_usage, api_key_usage_infra, api_keys_registry, roles, permission_overrides, record_permissions, field_permissions, feature_registry, custom_field_defs, onboarding_progress, invitations, announcements

**Automation:** automations, automation_runs, automation_workflows, workflows, workflow_actions, workflow_action_logs, workflow_executions, workflow_execution_logs, sequences, sequence_steps, sequence_enrollments, sequence_step_logs, assignment_rules, assignment_logs, at_risk_rules, approval_requests

**Communications:** comm_email_drafts, email_log, email_templates, email_tracking, email_clicks, email_opens, email_verifications, sms_messages, sms_templates, whatsapp_conversations, whatsapp_messages, whatsapp_templates, call_logs, call_notes, call_recordings, voice_calls, chat_messages, chat_sessions

**Tokens & Limits:** refresh_tokens, oauth_tokens, oauth_clients, oauth_codes, token_budgets, tenant_token_limits, user_token_limits, login_attempts, login_blocks, password_resets, limit_violations, usage_alerts, usage_snapshots

**Billing:** invoices, invoice_line_items, invoice_payments, subscriptions, contracts, plans, plan_limits, billing_events, tax_rates, tax_exemptions

**AI:** ai_activity, ai_credits_ledger, ai_draft_templates, ai_email_drafts, ai_insights, ai_module_configs, ai_provider_secrets, ai_usage_aggregated, ai_usage_logs, churn_predictions, content_generations, conversation_keywords, conversation_metrics

**Support:** support_tickets, ticket_replies, sla_policies, sla_breaches, service_categories, service_subscriptions, services

**Lead Warming:** lead_warming_campaigns, lead_warming_events, lead_warming_messages, lead_warming_replies, lead_warming_schedule, email_warmup_configs, email_warmup_logs, email_warmup_pool

**Marketing:** forms, form_submissions, segments, segment_members

**Security & Compliance:** security_events, compliance_requests, data_retention_policies, impersonation_sessions, sso_providers, sso_sessions, field_snapshots, edit_history

**Projects:** projects, project_tasks, milestones

**Financial:** exchange_rates, cost_anomalies, revenue_forecast_summary, revenue_opportunities, revenue_projections

**Others:** visitors, page_views, territories, territory_assignments, templates, saved_reports, scheduled_reports, report_templates, report_executions, dashboard_layouts, dashboard_templates, dashboards, modules, plugins, custom_plugins, plugin_execution_logs, integrations, kb_articles, kb_categories, history, audit_logs, super_admin_audit_logs, hierarchy_permissions, signing_requests, signing_events, document_folders, documents, file_attachments, file_uploads, backup_records, backup_schedules, backup_alerts, critical_data_backups, super_admin_backups, selective_restore_audit_log, selective_restore_logs, restore_snapshots, health_checks, error_logs, dead_letter_queue, failed_webhooks, webhook_deliveries, webhook_inbound_logs, webhook_queue, webhooks, system_settings, platform_settings, portal_clients, price_book_entries, price_books, product_templates, products, orders, order_line_items, quotes, quote_line_items, offers, approvals, rate_limits, email_drafts
</details>

---

## Features

### Core CRM

| Module | Features |
|---|---|
| **Contacts** | Lifecycle stages, scoring (BANT + ML), merge detection, duplicate warnings, timeline, tags, bulk operations, import/export CSV |
| **Companies** | Industry, size, revenue tracking, linked contacts, hierarchy |
| **Deals** | Kanban pipeline, drag-and-drop (dnd-kit), stage automation, forecasts, multi-currency |
| **Leads** | Source tracking, BANT scoring, conversion pipeline, assignment rules, auto-distribution |
| **Tasks** | Priority, due dates, assignment, bulk operations, kanban view, reminders |
| **Calendar** | Month/week/day views, meeting scheduling, Google Calendar sync integration |
| **Tickets** | Support helpdesk with replies, status workflow, internal notes, SLA tracking |
| **Knowledge Base** | Categories, articles, search, public customer portal, rich text |
| **Notes** | Per-entity notes, rich text, bulk operations |
| **Meetings** | Scheduling, calendar integration, video conferencing links |
| **Follow-ups** | Automated follow-up reminders, missed follow-up detection, bulk follow-ups |

### Sales & Billing

| Module | Features |
|---|---|
| **Invoices** | Line items, tax calculation, payment tracking, recurring invoices, PDF generation |
| **Quotes** | PDF generation, line items, approval workflow, public offer links |
| **Orders** | Order management, shipping, status tracking, line items |
| **Contracts** | Renewal tracking, auto-reminders, approval workflow |
| **Subscriptions** | Recurring billing, trial management, plan upgrades/downgrades |
| **Products** | Catalog with SKU, pricing, tax rates, price books, product templates |
| **Tax** | Automatic tax calculation, tax rates, tax exemptions, multi-jurisdiction |
| **Currency** | Multi-currency support, exchange rates, auto-conversion |

### AI-Powered Features

| Feature | Description |
|---|---|
| **Email Drafting** | AI-generated email drafts from context |
| **Content Generation** | Generate articles, templates, marketing copy |
| **Lead Scoring** | ML-based lead scoring with custom rules |
| **Sentiment Analysis** | Analyze customer communication sentiment |
| **Summarization** | Auto-summarize contacts, deals, tickets |
| **At-Risk Detection** | Predict churn and at-risk customers |
| **Activity Insights** | AI-powered activity recommendations |
| **AI Credits** | Per-tenant AI usage tracking and budgeting |
| **Multiple Providers** | OpenAI, Claude, with provider secret management |

### Automation

| Module | Features |
|---|---|
| **Workflows** | Visual drag-drop builder (xyflow/react), multi-step sequences, conditions, actions |
| **Email Sequences** | Drip campaigns, template variables, enrollment, step logs |
| **Automation Rules** | Event-based triggers (contact.created, deal.won, etc.) |
| **Webhooks** | Outbound event delivery with retry + dead letter queue |
| **Assignment Rules** | Auto-assign leads/contacts based on rules, round-robin, load balancing |
| **Lead Warming** | Automated email warmup campaigns, scheduled touchpoints, reply tracking |
| **Follow-up Automation** | Auto-create follow-ups, missed follow-up detection |

### Multi-Tenant Platform

| Feature | Details |
|---|---|
| **Tenant Isolation** | App-level + database RLS (20+ policies across all tables) |
| **RBAC** | Admin, manager, sales_rep, viewer + custom roles, granular permissions |
| **Plan Gating** | Feature access per plan (free/starter/pro/enterprise) |
| **Usage Tracking** | Per-tenant limits (contacts, deals, storage, API calls, AI credits) |
| **Super Admin** | Tenant management, global module toggles, audit logs, impersonation |
| **Multi-Brand** | Custom branding per tenant (logo, colors, domain) |
| **Territories** | Territory management with assignment rules |
| **Hierarchy** | Tenant hierarchy with parent/child relationships |

### Communication

| Channel | Features |
|---|---|
| **Email** | Send via Resend/SendGrid/Mailgun, templates, tracking (opens/clicks), bulk send, warmup |
| **SMS** | Send SMS, templates, webhook integration |
| **WhatsApp** | Send messages, templates, conversation tracking |
| **Chat** | Live chat widget, session management, message history |
| **Calls** | Call logging, notes, recordings, VoIP integration |
| **Notifications** | In-app notifications, SSE real-time push, email digests, matrix integration |
| **Telegram** | Telegram bot integration for notifications |

### Integrations & Plugin Engine

| Feature | Details |
|---|---|
| **Plugin Engine** | Connect any API with just a key + URL, auto-discovers API patterns |
| **Built-in Providers** | SendGrid, Slack, Mailgun, OpenAI, Resend, Stripe |
| **Module SDK** | Build standalone mini-SaaS apps on the CRM platform |
| **Webhooks** | Inbound/outbound with retry + logging + dead letter queue |
| **OAuth 2.0** | Full OAuth provider support for third-party apps |
| **SSO** | SAML, OpenID Connect providers, automatic login |
| **REST API** | Full REST API with OpenAPI docs at `/tenant/docs` |
| **API v2** | Enhanced API v2 with improved performance |

### Customer Portal

| Feature | Details |
|---|---|
| **Ticket Portal** | Self-service ticket creation and tracking |
| **Knowledge Base** | Public KB with categories and search |
| **Invoice Portal** | View and download invoices |
| **Portal Branding** | Custom-branded customer portal per tenant |

### Advanced Features

| Feature | Description |
|---|---|
| **Custom Fields** | Per-tenant custom field definitions with multiple types |
| **Saved Views** | Custom list views with filters, sorting, columns |
| **Reports & Dashboards** | Custom report builder, scheduled reports, widget-based dashboards |
| **Calculated Fields** | Formula engine for computed fields |
| **Bulk Operations** | Select + batch edit/delete/assign across entities |
| **Inline Editing** | Click-to-edit on data table cells |
| **Undo** | 10-second undo toast on destructive actions |
| **Keyboard Shortcuts** | Cmd+K command palette, Cmd+1-6 navigation |
| **Real-time Notifications** | SSE push for unread counts, live updates |
| **Dark Mode** | System-preference aware with theme toggle |
| **PWA** | Installable, offline-capable, service worker |
| **Trash & Recovery** | Soft delete with trash, restore, auto-cleanup |
| **Audit Logs** | Full audit trail for all entity changes |
| **History** | Entity change history with field-level diffs |
| **Import/Export** | CSV import/export for contacts, leads, data export |
| **Localization** | i18n support, language switching |
| **Accessibility** | WCAG-compliant, skip links, screen reader support |
| **Command Palette** | Cmd+K quick actions and navigation |
| **Mobile Responsive** | Mobile-first design with bottom sheets, swipeable, pull-to-refresh |

### Security

| Feature | Description |
|---|---|
| **JWT Auth** | Stateless JWT with httpOnly cookies, XSS-safe |
| **OAuth 2.0** | Authorization code flow, token management |
| **SSO** | SAML, OpenID Connect, auto-login |
| **2FA** | TOTP-based two-factor authentication |
| **CSRF Protection** | Anti-CSRF tokens for all mutations |
| **Rate Limiting** | Tiered rate limits per endpoint |
| **Brute Force Protection** | Login attempt tracking and blocking |
| **IP Whitelist** | Restrict access by IP address |
| **Data Encryption** | Field-level encryption for sensitive data |
| **Data Loss Prevention** | DLP policies and monitoring |
| **Session Management** | View and revoke active sessions |
| **Audit Logging** | Super admin and tenant-level audit trails |
| **Compliance** | GDPR, SOC2 support, data retention policies |
| **Field Permissions** | Granular field-level access control |
| **Record Permissions** | Per-record access control |
| **Security Events** | Security event monitoring and alerting |
| **Impersonation** | Super admin impersonation with full audit trail |
| **Input Sanitization** | HTML sanitization (DOMPurify) |
| **Encryption at Rest** | Database-level encryption |

### Compliance

| Feature | Description |
|---|---|
| **GDPR** | Data subject requests, right to deletion, data portability |
| **SOC2** | Audit trails, access controls, security monitoring |
| **Data Retention** | Configurable retention policies, auto-cleanup |
| **Backup & Restore** | Automated backups, point-in-time restore, selective restore |
| **Critical Data Capture** | Emergency data capture and alerting |

---

## API Reference

Browse the full interactive API docs at `/tenant/docs` (logged in).

### Authentication

All API endpoints except auth/public require either:
- **Cookie**: `nucrm_session` (set on login)
- **Bearer**: `Authorization: Bearer <jwt>`

### Rate Limits

| Endpoint | Limit | Window |
|---|---|---|
| All API | 60 req/min | 1 minute |
| Auth (login) | 10 req/min | 1 minute |
| Signup | 5 req/min | 1 minute |
| Password reset | 3 req/hour | 1 hour |
| AI endpoints | 30 req/hour | 1 hour |

### API Endpoints Overview (~290 routes)

#### Auth (20+ endpoints)
- `POST /api/auth/signup` — Create workspace + owner
- `POST /api/auth/login` — Sign in with email/password
- `POST /api/auth/logout` — Sign out
- `POST /api/auth/forgot-password` — Request password reset
- `POST /api/auth/reset-password` — Reset password
- `POST /api/auth/verify-email` — Verify email address
- `POST /api/auth/2fa/setup` — Setup 2FA
- `POST /api/auth/2fa/verify` — Verify 2FA code
- `POST /api/auth/2fa/disable` — Disable 2FA
- `GET /api/auth/oauth/authorize` — OAuth authorization
- `POST /api/auth/oauth/token` — OAuth token exchange
- `GET /api/auth/sso/[provider]` — SSO login
- `POST /api/auth/accept-invite` — Accept workspace invite

#### Tenant API (200+ endpoints)

**Core CRM:**
- `GET/POST /api/tenant/contacts` — List/create contacts
- `GET/PUT/DELETE /api/tenant/contacts/[id]` — Contact CRUD
- `POST /api/tenant/contacts/merge` — Merge duplicate contacts
- `POST /api/tenant/contacts/import` — Bulk import contacts
- `GET /api/tenant/contacts/export` — Export contacts
- `GET/POST /api/tenant/companies` — List/create companies
- `GET/POST /api/tenant/deals` — List/create deals
- `GET/POST /api/tenant/leads` — List/create leads
- `POST /api/tenant/leads/[id]/convert` — Convert lead to contact/deal
- `GET/POST /api/tenant/tasks` — List/create tasks
- `GET/POST /api/tenant/meetings` — List/create meetings
- `GET/POST /api/tenant/tickets` — List/create tickets
- `GET/POST /api/tenant/kb/articles` — Knowledge base articles
- `GET/POST /api/tenant/notes` — Notes

**Sales:**
- `GET/POST /api/tenant/invoices` — Invoices
- `GET/POST /api/tenant/quotes` — Quotes
- `GET/POST /api/tenant/orders` — Orders
- `GET/POST /api/tenant/contracts` — Contracts
- `GET/POST /api/tenant/subscriptions` — Subscriptions
- `GET/POST /api/tenant/products` — Products
- `GET/POST /api/tenant/tax` — Tax configuration
- `GET /api/tenant/currency` — Currency/exchange rates

**Automation:**
- `GET/POST /api/tenant/workflows` — Visual workflow builder
- `GET/POST /api/tenant/sequences` — Email sequences
- `GET/POST /api/tenant/automations` — Automation rules
- `GET/POST /api/tenant/webhooks` — Webhook management
- `GET/POST /api/tenant/assignment-rules` — Assignment rules

**AI:**
- `POST /api/tenant/ai/draft` — AI email drafting
- `POST /api/tenant/ai/summarize` — AI summarization
- `POST /api/tenant/ai/sentiment` — Sentiment analysis
- `POST /api/tenant/ai/score` — AI lead scoring
- `POST /api/tenant/ai/insights` — AI insights
- `GET /api/tenant/ai/credits` — AI credit balance
- `GET /api/tenant/ai/activity` — AI activity history

**Communications:**
- `POST /api/tenant/email/bulk` — Bulk email send
- `POST /api/tenant/email/test` — Test email
- `GET/POST /api/tenant/sms` — SMS messages
- `POST /api/tenant/whatsapp/send` — WhatsApp send
- `GET/POST /api/tenant/calls` — Call logging

**Dashboard & Analytics:**
- `GET /api/tenant/dashboard` — Dashboard data
- `GET /api/tenant/dashboard/stats` — Dashboard statistics
- `GET /api/tenant/dashboard/widgets/*` — Individual widget data
- `GET /api/tenant/analytics/stats` — Analytics stats
- `GET /api/tenant/analytics/forecast` — Revenue forecasts
- `GET /api/tenant/analytics/churn` — Churn analytics
- `GET/POST /api/tenant/reports` — Report builder

**Settings:**
- `GET/PUT /api/tenant/workspace` — Workspace settings
- `GET/PUT /api/tenant/branding` — Branding configuration
- `GET /api/tenant/me` — Current user profile
- `GET/POST /api/tenant/members` — Team members
- `GET/POST /api/tenant/roles` — Role management
- `GET/POST /api/tenant/custom-fields` — Custom fields
- `GET/POST /api/tenant/pipelines` — Pipeline management
- `GET/POST /api/tenant/views` — Saved views
- `GET/POST /api/tenant/integrations` — Integrations configuration
- `GET/POST /api/tenant/plugins` — Plugin management

#### Super Admin (40+ endpoints)
- `GET /api/superadmin/tenants` — List all tenants
- `GET /api/superadmin/tenants/[id]` — Tenant details
- `GET /api/superadmin/stats` — Platform statistics
- `GET /api/superadmin/usage` — Usage analytics
- `GET /api/superadmin/revenue` — Revenue analytics
- `GET /api/superadmin/adoption` — Feature adoption metrics
- `GET/PUT /api/superadmin/settings` — Platform settings
- `GET /api/superadmin/modules` — Module management
- `GET /api/superadmin/plans` — Plan management
- `GET /api/superadmin/audit-logs` — Platform audit logs
- `POST /api/superadmin/impersonate` — Impersonate tenant
- `GET /api/superadmin/health` — System health
- `GET /api/superadmin/errors` — Error logs
- `GET /api/superadmin/monitoring` — System monitoring
- `GET /api/superadmin/backups` — Backup management
- `POST /api/superadmin/selective-restore/execute` — Selective data restore
- `GET/POST /api/superadmin/templates` — Industry templates
- `GET /api/superadmin/tickets` — All tenant tickets

#### Cron Jobs (15+ endpoints)
- `GET /api/cron/auto-backup` — Automated database backup
- `GET /api/cron/cleanup` — Data cleanup (expired sessions, trash)
- `GET /api/cron/usage-snapshot` — Usage tracking snapshot
- `GET /api/cron/task-reminders` — Task reminder notifications
- `GET /api/cron/process-sequences` — Process email sequences
- `GET /api/cron/process-lead-scoring` — Recalculate lead scores
- `GET /api/cron/process-at-risk` — At-risk detection
- `GET /api/cron/lead-warming` — Lead warming scheduler
- `GET /api/cron/retry-webhooks` — Retry failed webhooks
- `GET /api/cron/subscription-check` — Subscription billing check
- `GET /api/cron/trial-check` — Trial expiry check
- `GET /api/cron/warmup-emails` — Email warmup scheduler
- `GET /api/cron/detect-missed-followups` — Missed follow-up detection
- `GET /api/cron/backup-health` — Backup health status check

#### Webhooks (5 endpoints)
- `POST /api/webhooks/stripe` — Stripe events
- `POST /api/webhooks/whatsapp` — WhatsApp incoming messages
- `POST /api/webhooks/resend` — Resend delivery events
- `POST /api/webhooks/inbound` — Generic inbound webhooks
- `POST /api/webhooks/inbound/tenant/[id]` — Tenant-scoped inbound

#### Public/Portal (10 endpoints)
- `GET /api/health` — Health check
- `GET /api/public/kb/articles` — Public KB articles
- `GET /api/public/invoices` — Public invoice lookup
- `GET /api/public/tickets` — Public ticket creation
- `GET /api/public/offers/[publicToken]` — Public offer view
- `POST /api/public/offers/[publicToken]/accept` — Accept offer
- `POST /api/public/offers/[publicToken]/decline` — Decline offer
- `POST /api/forms/submit` — Public form submission
- `GET /api/embed/form.js` — Embeddable form script

---

## Pages (~170 page.tsx files)

### Tenant Pages (~130)

| Area | Pages |
|---|---|
| **Dashboard** | Dashboard, AI activity |
| **CRM** | Contacts (list + detail), Companies (list + detail), Deals (list + kanban + detail), Leads (list + detail), Tasks (list + kanban + detail) |
| **Sales** | Invoices, Quotes, Orders, Contracts, Subscriptions, Products, Offers |
| **Support** | Tickets (list + kanban + detail) |
| **Knowledge** | KB (list + categories + article) |
| **Automation** | Workflows (list + builder), Sequences, Automation rules |
| **Communications** | Email templates, SMS, Calls, Chat |
| **Marketing** | Forms (list + builder + public), Lead warming, Segments |
| **Projects** | Projects (list + detail), Documents, eSignature |
| **Analytics** | Analytics (dashboard + forecast + email), Reports (list + builder + custom + scheduled), Leaderboards |
| **Settings** | General, Profile, Preferences, Security, Team, Roles, Permissions, Pipelines, Custom fields, Tags, Picklists, Email, SMS, Webhooks, Integrations, Plugins, API keys, Branding, Billing, Backup, Audit, Compliance, SSO, Tax, Currency, Localization, Login policy, User defaults, Notifications, Out of office, Portal, SLA, Territories, Hierarchy, Import/Export, Sessions, Telegram, AI providers, AI templates, AI activity, At-risk rules, Lead scoring, Assignment rules, Bulk transfer, Industry templates |
| **Other** | Search, Calendar, Trash, Notifications, Onboarding, Trial expired, Visitors |

### Super Admin Pages (~27)

| Area | Pages |
|---|---|
| **Management** | Dashboard, Tenants (list + detail + modules + roles + settings), Users, Tickets, Modules, Plans, Announcements |
| **Monitoring** | Health, Monitoring, Errors, Logs, Rate limits, Usage, Analytics, Adoption, Revenue, Billing |
| **Operations** | Backups, Selective restore, Data explorer, Token control, Settings, Templates (list + detail), Docs |

### Customer Portal Pages (5)

- Home/Dashboard, Tickets, Knowledge Base (list + article), Invoices

### Auth Pages (8)

- Login, Login (simple), Signup, Forgot password, Reset password, Verify email, Invite accept, No workspace

---

## Components

### UI Components (25+, Radix-based)

`badge`, `bottom-sheet`, `bulk-action-bar`, `button`, `card`, `checkbox`, `confirm-dialog`, `data-table`, `data-table-optimized`, `delete-confirm`, `dialog`, `dropdown-menu`, `error-boundary`, `inline-edit`, `input`, `language-switcher`, `mobile-card`, `optimized-image`, `pull-to-refresh`, `skeleton`, `skip-link`, `swipeable`, `table`, `index`

### Tenant Components (60+)

`advanced-search`, `call-logger`, `contacts-client`, `contacts-data-table`, `companies-client`, `companies-data-table`, `deals-client`, `deals-data-table`, `deals-kanban`, `leads-client`, `leads-client-new`, `tasks-client`, `tasks-data-table`, `contact-detail-client`, `deal-detail-client`, `lead-detail-client`, `task-detail-client`, `project-detail-client`, `contact-merge-modal`, `contact-timeline`, `lead-import-modal`, `import-modal`, `dashboard-client`, `pagination`, `saved-views`, `report-builder`, `sequence-builder`, `sequences-client`, `workflow-builder`, `whatsapp-chat`, `onboarding-checklist`, `email-verify-banner`, `plan-limit-banner`, `product-entry-client`, `projects-data-table` + subdirectories: `ai/`, `analytics/`, `automation/`, `dashboard/`, `follow-ups/`, `forms/`, `integrations/`, `layout/`, `sequences/`, `settings/`

### Shared Components (20+)

`animated-number`, `branded-header`, `breadcrumb`, `command-palette`, `confirm-polyfill`, `csrf-provider`, `empty-state`, `error-boundary`, `error-wrapper`, `impersonation-banner`, `lead-capture-form`, `offline-detector`, `pwa-install-prompt`, `route-error`, `save-shortcut`, `service-worker-registration`, `shortcuts-modal`, `simple-lead-form`, `theme-provider`, `user-preferences-applier`

### Super Admin Components

`backups-data-table`, `errors-data-table`, `header`, `shell`, `sidebar`, `tenants-data-table`, `users-data-table`

---

## Tests (~115 test files)

| Type | Files | Description |
|---|---|---|
| **Unit Tests** | ~85 | Component, utility, service, and model tests |
| **Integration Tests** | 9 | API validation, backup integrity, tenant isolation, security, calculated fields |
| **E2E Tests** | 6 | Auth, contacts, deals, multi-tenant, notifications, smoke |
| **Dashboard Tests** | 10 | Widget rendering, data fetching, caching |

**Test commands:**
```bash
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:e2e            # Playwright E2E tests
npm run test:coverage       # With coverage report
npm run test:watch          # Watch mode
```

---

## Scripts (~25 scripts)

### Database
| Script | Description |
|---|---|
| `npm run db:sync` | Push schema to database (create/update tables) |
| `npm run db:migrate` | Run pending migrations |
| `npm run db:generate` | Generate new migration file |
| `npm run db:rollback` | Roll back last migration |
| `npm run db:status` | Check migration status |
| `npm run db:drop` | Drop all tables (destructive) |
| `npm run db:reset` | Drop all tables + re-sync |

### Seeding
| Script | Description |
|---|---|
| `npm run seed:dev` | Seed development data |
| `npm run seed:e2e` | Seed e2e test user |
| `npm run db:seed` | Seed with advanced demo data |
| `npm run db:demo` | Seed massive dataset for testing |
| `npm run prod:seed` | Production data seeding |

### Development
| Script | Description |
|---|---|
| `npm run dev` | Start dev server (with DB sync) |
| `npm run dev:nosync` | Start dev server without DB sync |
| `npm run dev:all` | Start app + worker concurrently |
| `npm run worker` | Start background worker |
| `npm run worker:dev` | Start worker in watch mode |
| `npm run storybook` | Storybook component library |

### Quality
| Script | Description |
|---|---|
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run check` | Typecheck + lint + unit tests |
| `npm run quality:full` | Full quality check (typecheck + lint + tests + report) |
| `npm run quality:report` | Generate quality report |
| `npm run quality:lint` | ESLint with max warnings |
| `npm run coverage` | Test coverage report |
| `npm run analyze:bundle` | Bundle size analysis |
| `npm run lighthouse:audit` | Lighthouse performance audit |

### Production
| Script | Description |
|---|---|
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run prod:start` | Production start with script |
| `npm run prod:preflight` | Pre-flight checks |
| `npm run prod:launch` | Full production launch |
| `npm run up` | Bootstrap entire stack |
| `npm run premerge` | Pre-merge checks |
| `npm run smoke` | Smoke tests |
| `npm run setup` | Initial project setup |

---

## Deployment

### Docker
```bash
docker-compose up -d
```

Includes: Next.js app, PostgreSQL 16, Redis 7, Nginx, PG Bouncer, Workers, Cron

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret (64+ chars) |
| `SETUP_KEY` | Yes | Initial setup authorization key |
| `NEXT_PUBLIC_APP_URL` | Yes | Public application URL |
| `SESSION_SECRET` | Yes | Session encryption secret |
| `ENCRYPTION_KEY` | Yes | Field-level encryption key |
| `REDIS_URL` | No | Redis connection (caching, queues) |
| `RESEND_API_KEY` | No | Email sending via Resend |
| `STRIPE_SECRET_KEY` | No | Stripe payment processing |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook verification |
| `AWS_ACCESS_KEY_ID` | No | S3 file storage |
| `AWS_SECRET_ACCESS_KEY` | No | S3 file storage |
| `AWS_S3_BUCKET` | No | S3 bucket name |
| `OPENAI_API_KEY` | No | AI features |
| `SENTRY_DSN` | No | Error tracking |
| `CRON_SECRET` | No | Cron job authentication |
| `METRICS_SECRET` | No | Metrics endpoint auth |

### Deployment Options

- **Docker Compose** — Full stack deployment
- **Standalone** — `npm run build && npm start`
- **VM/ Bare Metal** — Nginx reverse proxy, PM2 process management
- **Kubernetes** — Docker images available

### Monitoring

- **Sentry** — Error tracking (client + server + edge)
- **Grafana** — Dashboards and metrics visualization
- **Prometheus** — Metrics collection
- **Lighthouse** — Performance auditing
- **Health Checks** — `/api/health`, `/api/health/worker`
- **Log Viewer** — Built-in log viewer UI
- **Grafana Logging** — Structured logging with Grafana integration

### CI/CD (GitHub Actions)

- **CI Pipeline**: Lint → Typecheck → Security scan (Semgrep + npm audit) → Build → Unit tests → Integration tests
- **Deploy Pipeline**: Automated deployment workflow

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [REPO_POLICY.md](REPO_POLICY.md).

## License

MIT

---

## Quick Stats

| Metric | Value |
|---|---|
| Database Tables | 215 |
| Schema Files | 35 |
| API Routes | ~290 |
| Tenant Pages | ~130 |
| Super Admin Pages | ~27 |
| Portal Pages | 5 |
| Auth Pages | 8 |
| UI Components | 25+ |
| Tenant Components | 60+ |
| Unit Tests | ~85 files |
| Integration Tests | 9 files |
| E2E Tests | 6 specs |
| Dashboard Tests | 10 files |
| Scripts | ~25 |
| Node Version | >=22 |
| Next.js Version | 16.2.6 |
| TypeScript Version | 5.9 |
