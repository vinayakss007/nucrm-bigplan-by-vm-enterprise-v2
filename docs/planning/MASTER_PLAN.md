# NuCRM — Master Plan for All 3 Repos

**Created:** 2026-05-21
**Status:** Living document — update as plans evolve

---

## REPOSITORY HIERARCHY

```
bigplan (BASE v1.0.0)
  │
  ├─── fixes ───→ bigplan2 (FEATURES v1.1.0+)
  │                    │
  │                    ├─── fixes + features ───→ enterprise (FULL v2.0.0+)
  │
  └─── fixes ───────────────────────────────→ enterprise (FULL v2.0.0+)

NEVER flows backwards:
  enterprise ─X─→ bigplan2 (no features)
  enterprise ─X─→ bigplan (no features)
  bigplan2 ─X─→ bigplan (no features)
```

---

## REPO 1: nucrm-bigplan (BASE)

**Role:** Stable foundation. No new features ever. Only performance, reliability, security fixes.
**Version:** v1.0.0
**GitHub:** `vinayakss007/nucrm-bigplan-by-vm`

### What's Already Built (v1.0.0 — 9.31/10)
- ✅ 23 foundational gaps resolved (TypeScript, XSS, rate limiting, caching, pagination, migrations, CI/CD, Sentry, a11y, i18n, mobile, OpenAPI, webhook DLQ, audit integrity, tenant isolation, bundle analysis)
- ✅ Docker + docker-compose (dev + prod)
- ✅ CI/CD pipeline (lint, test, e2e, build, deploy, load tests)
- ✅ Module registry with plan-based pricing
- ✅ S3/R2 storage integration
- ✅ Redis caching layer
- ✅ Backup integrity testing
- ✅ Tenant isolation (RLS)
- ✅ Accessibility (WCAG 2.1 AA)
- ✅ i18n/localization foundation
- ✅ Mobile-first UI components

### What Needs to Be Built (BASE fixes only)
| Task | Type | Priority |
|------|------|----------|
| Module enforcement middleware (`lib/modules/gate.ts`) | Security | HIGH |
| Auto-install modules on tenant signup | Reliability | HIGH |
| Usage tracking per user (`user_usage` table) | Performance | HIGH |
| Usage limit enforcement middleware | Reliability | HIGH |
| Plan limits table + seed data | Reliability | HIGH |
| Super admin tenant management UI (monitoring dashboard) | Security | HIGH |
| Fix remaining pagination gaps (workflows, custom-fields, leads/history) | Performance | MEDIUM |
| Fix deals response (missing hasMore/limit/offset) | Performance | MEDIUM |

### What Will NEVER Be Added to bigplan
- ❌ New features (AI, SQL export, audit logs, leaderboards, forecasting, etc.)
- ❌ New pages or components
- ❌ New integrations (Stripe, Twilio, etc.)
- ❌ UI redesigns

---

## REPO 2: nucrm-bigplan2 (FEATURES)

**Role:** Gets ALL fixes from bigplan. Adds the focused feature set.
**Version:** v1.1.0+
**GitHub:** `vinayakss007/nucrm-bigplan2`

### What's Already Built (On Top of bigplan)
- ✅ Flexible AI system (multi-provider: Anthropic, OpenAI, Groq, Gemini, Ollama)
- ✅ SQL data export (per-tenant, per-user)
- ✅ Superadmin audit logs page + API
- ✅ Superadmin cron monitoring page + API
- ✅ Superadmin export API (cross-tenant)
- ✅ Tenant activity timeline (superadmin)
- ✅ Tenant role management (superadmin)
- ✅ Missing CRUD routes for 8 entities (invoices, orders, contracts, quotes, subscriptions, meetings, activities, webhooks)
- ✅ Pagination on email-templates, meetings, notifications, activities, tickets
- ✅ Loading.tsx + error.tsx on 40+ pages
- ✅ Bulk DELETE on all collection routes
- ✅ Permission checks on financial routes
- ✅ Cross-tenant isolation bug fixes

### What Needs to Be Built (v1.1.0 Feature Set)
| Feature | Description | Priority |
|---------|-------------|----------|
| **FEAT-02: Advanced Search** | Multi-field search (name + email + company + status + date range). Saved search presets. Filter chips. | HIGH |
| **FEAT-04: Team Leaderboards** | Sales performance rankings by user. Deals won, revenue, activities. Weekly/monthly toggle. | MEDIUM |
| **FEAT-05: Document Management** | Upload, organize, share files per entity. Uses existing S3/R2 storage. Presigned URL uploads. Preview images/PDFs. | HIGH |
| **FEAT-08: Revenue Forecasting** | Predictive pipeline revenue. Weighted close probability. Monthly/quarterly projections. | HIGH |
| **FEAT-13: Multi-Currency** | Display deals/invoices in multiple currencies. Exchange rate API. Currency conversion. | MEDIUM |
| **FEAT-16: SMS (Twilio)** | Send/receive SMS from contact detail. SMS templates. Delivery tracking. | MEDIUM |
| **FEAT-20: Visitor Tracking** | Identify anonymous website visitors. Page view tracking. Lead scoring from behavior. | MEDIUM |
| **FEAT-PAY: Stripe Payments** | Complete payment processing. Invoice payment links. Subscription billing. Webhook handling. | HIGH |

### Module Activation (bigplan2 gets from bigplan)
- Module enforcement middleware (from bigplan)
- Auto-install on signup (from bigplan)
- Super admin module management UI (from bigplan)
- Tenant module marketplace (from bigplan)
- Feature-level toggles (from bigplan)

### Usage Limits (bigplan2 gets from bigplan)
- Per-user usage tracking (from bigplan)
- Usage limit enforcement (from bigplan)
- Warning notifications (from bigplan)
- Tenant usage dashboard (from bigplan)

### What Will NEVER Be Added to bigplan2
- ❌ Enterprise-only features (SSO, white-label, advanced compliance, etc.)

---

## REPO 3: nucrm-enterprise (FULL)

**Role:** Gets ALL fixes from bigplan AND bigplan2. Gets ALL features from bigplan2. Adds enterprise-only features.
**Version:** v2.0.0+
**GitHub:** `vinayakss007/nucrm-bigplan-by-vm-enterprise-v2`

### What's Already Built (On Top of bigplan + bigplan2)
- ✅ All bigplan fixes (23 foundational gaps)
- ✅ All bigplan2 features (AI, SQL export, audit logs, CRUD routes, loading states, etc.)
- ✅ ESLint error fixes (22 errors resolved)
- ✅ Vercel deployment config

### What Needs to Be Built (Enterprise-Only Features)
| Feature | Description | Priority |
|---------|-------------|----------|
| **SSO / SAML** | Okta, Azure AD, Google Workspace SSO integration | HIGH |
| **White-Label Branding** | Custom domain, custom logo, custom colors, remove NuCRM branding | HIGH |
| **Advanced Compliance** | SOC 2 reports, GDPR data export, audit log immutability, data retention policies | HIGH |
| **Advanced RBAC** | Field-level permissions, record-level permissions, approval workflows | MEDIUM |
| **Multi-Tenant Hierarchy** | Parent-child organizations, regional divisions, cross-tenant reporting | MEDIUM |
| **Advanced Analytics** | Custom report builder, scheduled PDF reports, data warehouse export | MEDIUM |
| **API Rate Limit Tiers** | Different API limits per plan, custom rate limits per tenant | LOW |
| **Dedicated Infrastructure** | Single-tenant deployment option, dedicated DB, dedicated Redis | LOW |
| **SLA Management** | Response time targets, escalation rules, breach alerts, SLA reporting | LOW |
| **Auto-Assignment Rules** | Round-robin lead distribution, territory-based routing, skill-based matching | LOW |
| **E-Signature Integration** | DocuSign/HelloSign integration. Sign contracts inline. Signature tracking. | LOW |
| **Territory Management** | Geographic/vertical territory splits. Territory-based reporting. | LOW |
| **Tax Management** | Tax rate configuration. Automatic tax calculations. Tax reporting. | LOW |
| **Website Visitor Tracking** | Identify anonymous visitors. Page view tracking. Lead scoring from behavior. | LOW |

### Module Activation (enterprise gets from bigplan + bigplan2)
- Everything from bigplan (enforcement, auto-install, super admin UI)
- Everything from bigplan2 (tenant marketplace, feature toggles)
- Plus: Enterprise-only modules (SSO, white-label, compliance)

### Usage Limits (enterprise gets from bigplan + bigplan2)
- Everything from bigplan (tracking, enforcement, notifications)
- Everything from bigplan2 (tenant dashboard, per-user breakdown)
- Plus: Enterprise overrides (unlimited everything, custom limits per tenant)

---

## SUPER ADMIN CAPABILITIES (All 3 Repos)

Super admin can do ALL of the following from the monitoring dashboard:

### Module Management
- Toggle modules globally on/off (`isAvailable`)
- Set pricing per plan for each module
- Set default modules per plan
- Force-enable/disable modules for any tenant
- View install stats per module
- View revenue from add-ons

### Usage Management
- Edit limits for each plan (users, contacts, storage, API, etc.)
- Override limits for specific tenant
- View per-user breakdown within any tenant
- See which user is consuming most resources
- Manually reset counters
- Change tenant's plan

### Tenant Management
- View any tenant's usage, modules, settings
- Impersonate any tenant admin
- View audit logs for any tenant
- View per-user activity within any tenant
- Suspend/activate any tenant
- Delete tenant data

### Analytics
- Total users across all tenants
- Total contacts, deals, storage
- API call volume over time
- Top consuming tenants
- Revenue impact of limit-driven upgrades
- Module usage analytics

---

## PLAN TIERS (All 3 Repos)

### Free Plan
| Resource | Limit |
|----------|-------|
| Users | 1 |
| Contacts | 500 |
| Deals | 100 |
| Storage | 100 MB |
| API Calls/day | 100 |
| AI Tokens | 0 |
| Emails/day | 50 |
| Automations | 3 active |
| Tickets | 50 |
| Forms | 1 |
| Custom Fields | 5 per entity |
| File Upload | 5 MB max |
| Modules | core-crm, automation-basic |

### Starter Plan ($29/mo)
| Resource | Limit |
|----------|-------|
| Users | 5 |
| Contacts | 5,000 |
| Deals | 500 |
| Storage | 2 GB |
| API Calls/day | 1,000 |
| AI Tokens | 0 |
| Emails/day | 500 |
| Automations | 10 active |
| Tickets | 200 |
| Forms | 3 |
| Custom Fields | 10 per entity |
| File Upload | 10 MB max |
| Modules | core-crm, automation-basic, helpdesk, quotes, segments, automation-pro, whatsapp, email-sync |
| Add-Ons | forms-builder (+$10/mo) |

### Pro Plan ($79/mo)
| Resource | Limit |
|----------|-------|
| Users | 25 |
| Contacts | 50,000 |
| Deals | 5,000 |
| Storage | 20 GB |
| API Calls/day | 10,000 |
| AI Tokens | 100,000 |
| Emails/day | 5,000 |
| Automations | 50 active |
| Tickets | 2,000 |
| Forms | 10 |
| Custom Fields | 25 per entity |
| File Upload | 25 MB max |
| Modules | Everything in Starter |
| Add-Ons | ai-assistant (+$25), analytics-pro (+$15), calculated-fields (+$15), industry-templates (+$20) |

### Enterprise Plan (Custom)
| Resource | Limit |
|----------|-------|
| Users | Unlimited |
| Contacts | Unlimited |
| Deals | Unlimited |
| Storage | 200 GB |
| API Calls/day | 100,000 |
| AI Tokens | 1,000,000 |
| Emails/day | Unlimited |
| Automations | Unlimited |
| Tickets | Unlimited |
| Forms | Unlimited |
| Custom Fields | Unlimited |
| File Upload | 100 MB max |
| Modules | ALL included free |
| Add-Ons | None needed (everything included) |
| Enterprise Features | SSO, white-label, advanced compliance, dedicated infra |

---

## SYNC CHECKLIST

### When bigplan gets a fix:
- [ ] Apply to bigplan
- [ ] Apply to bigplan2
- [ ] Apply to enterprise

### When bigplan2 gets a fix:
- [ ] Apply to bigplan2
- [ ] Apply to enterprise
- [ ] Apply to bigplan ONLY if it's a performance/reliability/security fix

### When bigplan2 gets a feature:
- [ ] Apply to bigplan2
- [ ] Apply to enterprise
- [ ] DO NOT apply to bigplan

### When enterprise gets a fix:
- [ ] Apply to enterprise
- [ ] Apply to bigplan ONLY if it's a performance/reliability/security fix
- [ ] Apply to bigplan2 ONLY if it's a performance/reliability/security fix

### When enterprise gets a feature:
- [ ] Apply to enterprise
- [ ] DO NOT apply to bigplan
- [ ] DO NOT apply to bigplan2

---

## IMPLEMENTATION ORDER (Next Steps)

### Phase 1: Foundation (bigplan first)
1. Module enforcement middleware (`lib/modules/gate.ts`)
2. Auto-install modules on tenant signup
3. Usage tracking per user (`user_usage` table)
4. Usage limit enforcement middleware
5. Plan limits table + seed data
6. Super admin tenant management UI

### Phase 2: Features (bigplan2)
7. Advanced Search (FEAT-02)
8. Document Management (FEAT-05)
9. Revenue Forecasting (FEAT-08)
10. Stripe Payments (FEAT-PAY)
11. Team Leaderboards (FEAT-04)
12. Multi-Currency (FEAT-13)
13. SMS Integration (FEAT-16)
14. Visitor Tracking (FEAT-20)

### Phase 3: Enterprise (enterprise)
15. SSO / SAML
16. White-Label Branding
17. Advanced Compliance
18. Advanced RBAC
19. Multi-Tenant Hierarchy
20. Advanced Analytics
21. SLA Management
22. Auto-Assignment Rules
23. E-Signature Integration
24. Territory Management
25. Tax Management
