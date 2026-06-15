# NuCRM Enterprise — Complete Plan Document

**Repo:** `nucrm-enterprise` (FULL)
**GitHub:** `vinayakss007/nucrm-bigplan-by-vm-enterprise-v2`
**Version:** v2.0.0+
**Role:** Gets ALL fixes from bigplan AND bigplan2. Gets ALL features from bigplan2. Adds enterprise-only features.

---

## WHAT'S ALREADY BUILT (On Top of bigplan + bigplan2)

### From bigplan (synced)
- ✅ All 23 foundational gaps resolved
- ✅ Docker + docker-compose (dev + prod)
- ✅ CI/CD pipeline
- ✅ Module registry with plan-based pricing
- ✅ S3/R2 storage integration
- ✅ Redis caching layer
- ✅ Backup integrity testing
- ✅ Tenant isolation (RLS)
- ✅ Accessibility (WCAG 2.1 AA)
- ✅ i18n/localization foundation
- ✅ Mobile-first UI components
- ✅ Deployment infrastructure
- ✅ Dockerfile build-time env vars
- ✅ `--legacy-peer-deps` in CI

### From bigplan2 (synced)
- ✅ Flexible AI system (multi-provider)
- ✅ SQL data export (per-tenant, per-user, superadmin)
- ✅ Superadmin audit logs + cron monitoring
- ✅ Tenant activity timeline + role management
- ✅ Missing CRUD routes for 8 entities
- ✅ Pagination on heavy endpoints
- ✅ Loading.tsx + error.tsx on 40+ pages
- ✅ Bulk DELETE on collection routes
- ✅ Permission checks on financial routes
- ✅ Cross-tenant isolation bug fixes
- ✅ `critters` for CSS optimization

### Enterprise Exclusive
- ✅ ESLint error fixes (22 errors resolved)
- ✅ Vercel deployment config
- ✅ `ignoreBuildErrors: process.env.CI === 'true'` (CI-gated, not always true)

---

## WHAT NEEDS TO BE BUILT (Enterprise-Only Features)

### HIGH Priority
| Feature | Description | Files to Create |
|---------|-------------|-----------------|
| **SSO / SAML** | Okta, Azure AD, Google Workspace SSO integration. SAML 2.0, OIDC support. | `lib/auth/sso.ts`, `app/api/auth/sso/callback/route.ts`, `app/tenant/settings/sso/page.tsx`, `app/superadmin/settings/sso/page.tsx` |
| **White-Label Branding** | Custom domain, custom logo, custom colors, remove NuCRM branding. Per-tenant branding config. | `lib/branding.ts`, `app/api/tenant/branding/route.ts`, `app/tenant/settings/branding/page.tsx`, `components/shared/branded-header.tsx` |
| **Advanced Compliance** | SOC 2 reports, GDPR data export, audit log immutability, data retention policies. | `lib/compliance/gdpr.ts`, `lib/compliance/soc2.ts`, `app/api/tenant/compliance/export/route.ts`, `app/tenant/settings/compliance/page.tsx` |

### MEDIUM Priority
| Feature | Description | Files to Create |
|---------|-------------|-----------------|
| **Advanced RBAC** | Field-level permissions, record-level permissions, approval workflows. | `lib/rbac/field-permissions.ts`, `lib/rbac/record-permissions.ts`, `app/tenant/settings/rbac/page.tsx` |
| **Multi-Tenant Hierarchy** | Parent-child organizations, regional divisions, cross-tenant reporting. | `drizzle/schema/hierarchy.ts`, `app/api/tenant/hierarchy/route.ts`, `app/tenant/settings/hierarchy/page.tsx` |
| **Advanced Analytics** | Custom report builder, scheduled PDF reports, data warehouse export. | `app/tenant/reports/builder/page.tsx`, `lib/reports/pdf-export.ts`, `app/api/tenant/reports/schedule/route.ts` |
| **API Rate Limit Tiers** | Different API limits per plan, custom rate limits per tenant. | `lib/rate-limit/tiers.ts`, `app/superadmin/settings/rate-limits/page.tsx` |
| **Dedicated Infrastructure** | Single-tenant deployment option, dedicated DB, dedicated Redis. | `scripts/deploy-dedicated.sh`, `docker-compose.dedicated.yml` |

### LOW Priority
| Feature | Description | Files to Create |
|---------|-------------|-----------------|
| **SLA Management** | Response time targets, escalation rules, breach alerts, SLA reporting. | `lib/sla.ts`, `app/api/tenant/sla/route.ts`, `app/tenant/settings/sla/page.tsx` |
| **Auto-Assignment Rules** | Round-robin lead distribution, territory-based routing, skill-based matching. | `lib/assignment.ts`, `app/api/tenant/assignment-rules/route.ts` |
| **E-Signature Integration** | DocuSign/HelloSign integration. Sign contracts inline. Signature tracking. | `lib/esignature.ts`, `app/api/tenant/esignature/route.ts` |
| **Territory Management** | Geographic/vertical territory splits. Territory-based reporting. | `lib/territories.ts`, `app/api/tenant/territories/route.ts` |
| **Tax Management** | Tax rate configuration. Automatic tax calculations. Tax reporting. | `lib/tax.ts`, `app/api/tenant/tax/route.ts` |

---

## WHAT ENTERPRISE GETS FROM BIGPLAN (Auto-synced)

### Module Activation
- Module enforcement middleware (`lib/modules/gate.ts`)
- Auto-install modules on tenant signup
- Super admin module management UI
- Tenant module marketplace
- Feature-level toggles

### Usage Limits
- Per-user usage tracking (`user_usage` table)
- Usage limit enforcement middleware
- Warning notifications (80%, 90%, 100%)
- Tenant usage dashboard
- Super admin plan limits editor
- Per-tenant usage override

### Infrastructure Fixes
- Dockerfile build-time env vars
- CI `--legacy-peer-deps`
- docker-compose worker service
- docker-compose.prod.yml
- scripts/deploy.sh
- .env.production.example
- CI deploy jobs

---

## WHAT ENTERPRISE GETS FROM BIGPLAN2 (Auto-synced)

### Features
- Flexible AI system (multi-provider)
- SQL data export
- Superadmin audit logs + cron monitoring
- Tenant activity timeline + role management
- Missing CRUD routes for 8 entities
- Pagination on heavy endpoints
- Loading.tsx + error.tsx on 40+ pages
- Bulk DELETE on collection routes
- Permission checks on financial routes
- Cross-tenant isolation bug fixes
- CSS optimization (`critters`)

### v1.1.0 Features (when built)
- Advanced Search (FEAT-02)
- Document Management (FEAT-05)
- Revenue Forecasting (FEAT-08)
- Stripe Payments (FEAT-PAY)
- Team Leaderboards (FEAT-04)
- Multi-Currency (FEAT-13)
- SMS Integration (FEAT-16)
- Visitor Tracking (FEAT-20)

---

## ENTERPRISE-ONLY MODULES

These modules are ONLY available in the enterprise repo:

| ID | Name | Description |
|----|------|-------------|
| `sso-saml` | SSO / SAML | Okta, Azure AD, Google Workspace SSO |
| `white-label` | White-Label Branding | Custom domain, logo, colors, no NuCRM branding |
| `compliance-pro` | Advanced Compliance | SOC 2 reports, GDPR export, audit immutability |
| `rbac-advanced` | Advanced RBAC | Field-level, record-level permissions, approval workflows |
| `hierarchy` | Multi-Tenant Hierarchy | Parent-child orgs, regional divisions |
| `analytics-advanced` | Advanced Analytics | Custom report builder, PDF reports, warehouse export |
| `dedicated-infra` | Dedicated Infrastructure | Single-tenant deployment, dedicated DB/Redis |
| `sla-management` | SLA Management | Response time targets, escalation rules |
| `auto-assignment` | Auto-Assignment | Round-robin, territory-based, skill-based |
| `esignature` | E-Signature | DocuSign/HelloSign integration |
| `territory` | Territory Management | Geographic/vertical splits |
| `tax-management` | Tax Management | Tax rates, calculations, reporting |

---

## ENTERPRISE PLAN (Custom Pricing)

| Resource | Limit |
|----------|-------|
| Users | Unlimited |
| Contacts | Unlimited |
| Deals | Unlimited |
| Storage | 200 GB (customizable) |
| API Calls/day | 100,000 (customizable) |
| AI Tokens | 1,000,000 (customizable) |
| Emails/day | Unlimited |
| Automations | Unlimited |
| Tickets | Unlimited |
| Forms | Unlimited |
| Custom Fields | Unlimited |
| File Upload | 100 MB max |
| Modules | ALL included free (including enterprise-only) |
| SSO | ✅ Included |
| White-Label | ✅ Included |
| Compliance | ✅ Included |
| Dedicated Infra | ✅ Available (extra cost) |
| SLA | ✅ 99.9% uptime guarantee |
| Support | ✅ Priority support |

---

## SUPER ADMIN CAPABILITIES

Everything from bigplan + bigplan2, PLUS:

### Enterprise Controls
- Configure SSO providers for any tenant
- Enable/disable white-label per tenant
- Set custom limits per tenant (override plan defaults)
- Deploy dedicated infrastructure for specific tenants
- View compliance reports across all tenants
- Manage enterprise-only modules

---

## FILES TO CREATE/MODIFY (enterprise specific)

| File | Action | Purpose |
|------|--------|---------|
| `lib/auth/sso.ts` | CREATE | SSO/SAML integration |
| `app/api/auth/sso/callback/route.ts` | CREATE | SSO callback handler |
| `app/tenant/settings/sso/page.tsx` | CREATE | Tenant SSO settings |
| `app/superadmin/settings/sso/page.tsx` | CREATE | Super admin SSO management |
| `lib/branding.ts` | CREATE | White-label branding engine |
| `app/api/tenant/branding/route.ts` | CREATE | Branding API |
| `app/tenant/settings/branding/page.tsx` | CREATE | Tenant branding settings |
| `components/shared/branded-header.tsx` | CREATE | Branded header component |
| `lib/compliance/gdpr.ts` | CREATE | GDPR data export |
| `lib/compliance/soc2.ts` | CREATE | SOC 2 report generation |
| `app/api/tenant/compliance/export/route.ts` | CREATE | Compliance export API |
| `app/tenant/settings/compliance/page.tsx` | CREATE | Compliance settings |
| `lib/rbac/field-permissions.ts` | CREATE | Field-level permissions |
| `lib/rbac/record-permissions.ts` | CREATE | Record-level permissions |
| `app/tenant/settings/rbac/page.tsx` | CREATE | RBAC settings |
| `drizzle/schema/hierarchy.ts` | CREATE | Multi-tenant hierarchy schema |
| `app/api/tenant/hierarchy/route.ts` | CREATE | Hierarchy API |
| `app/tenant/settings/hierarchy/page.tsx` | CREATE | Hierarchy settings |
| `app/tenant/reports/builder/page.tsx` | CREATE | Custom report builder UI |
| `lib/reports/pdf-export.ts` | CREATE | PDF report generation |
| `app/api/tenant/reports/schedule/route.ts` | CREATE | Scheduled reports API |
| `lib/rate-limit/tiers.ts` | CREATE | API rate limit tiers |
| `scripts/deploy-dedicated.sh` | CREATE | Dedicated infra deploy script |
| `docker-compose.dedicated.yml` | CREATE | Dedicated infra compose |
| `lib/sla.ts` | CREATE | SLA management engine |
| `app/api/tenant/sla/route.ts` | CREATE | SLA API |
| `lib/assignment.ts` | CREATE | Auto-assignment engine |
| `app/api/tenant/assignment-rules/route.ts` | CREATE | Assignment rules API |
| `lib/esignature.ts` | CREATE | E-signature integration |
| `app/api/tenant/esignature/route.ts` | CREATE | E-signature API |
| `lib/territories.ts` | CREATE | Territory management |
| `app/api/tenant/territories/route.ts` | CREATE | Territories API |
| `lib/tax.ts` | CREATE | Tax management |
| `app/api/tenant/tax/route.ts` | CREATE | Tax API |

---

## IMPLEMENTATION ORDER

1. **SSO / SAML** — High impact, required for enterprise adoption
2. **White-Label Branding** — High impact, key enterprise selling point
3. **Advanced Compliance** — High impact, required for enterprise buyers
4. **Advanced RBAC** — Medium impact, security requirement
5. **Multi-Tenant Hierarchy** — Medium impact, large org requirement
6. **Advanced Analytics** — Medium impact, reporting requirement
7. **API Rate Limit Tiers** — Low impact, operational improvement
8. **Dedicated Infrastructure** — Low impact, premium offering
9. **SLA Management** — Low impact, service improvement
10. **Auto-Assignment Rules** — Low impact, workflow improvement
11. **E-Signature Integration** — Low impact, niche requirement
12. **Territory Management** — Low impact, niche requirement
13. **Tax Management** — Low impact, niche requirement

---

## SYNC RULES

### enterprise receives from bigplan (ALWAYS)
- ✅ All fixes
- ✅ Module enforcement
- ✅ Usage tracking
- ✅ Plan limits
- ✅ Super admin UI
- ✅ Infrastructure fixes

### enterprise receives from bigplan2 (ALWAYS)
- ✅ All fixes from bigplan2
- ✅ All features from bigplan2

### enterprise NEVER sends to:
- ❌ bigplan (no features, no fixes unless performance/reliability/security)
- ❌ bigplan2 (no features, no fixes unless performance/reliability/security)
