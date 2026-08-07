# NuCRM — Future Plan (2027)

## ⚠️ EXECUTION RULES

### DO NOT START WITHOUT CONFIRMATION

**This roadmap will NOT be started without DOUBLE CONFIRMATION from Vinayak.**

Before any work begins on this roadmap:

1. Get explicit approval from Vinayak (verbal or written)
2. Get confirmation again after presenting the plan
3. Only then begin Phase 1

### Timeline: 2027

**This roadmap is scheduled for execution in 2027.**

- 2026: Focus on fixing existing bugs, stabilizing the current app
- 2027: Execute this SaaS platform roadmap

### Why Wait?

1. Fix the 88 critical issues first (2026 work)
2. Get existing app stable and running in production
3. Validate the current CRM is working properly
4. Then build SaaS layer on top of stable foundation

---

## Vision

Use NuCRM as the core backbone to build a multi-tenant SaaS application. The CRM already has 70% of SaaS infrastructure built. Focus on activating existing features, not rebuilding.

---

## Phase 1: Foundation Cleanup (Week 1)

### Critical Bugs to Fix First

- [ ] Fix lead status field mismatch (`lead_status` vs `status`) — Issue #1076
- [ ] Fix convert dialog stage mismatch (`stage_id` vs `deal_stage`) — Issue #1077
- [ ] Fix notes PATCH writes to wrong column — Issue #1078
- [ ] Add CSRF to all superadmin mutations — Issue #1086
- [ ] Fix empty cron secret sent from settings — Issue #1087
- [ ] Fix contact activity type always becomes note — Issue #1079

### Code Cleanup

- [ ] Delete dead code: `leads-client.tsx` (legacy, hits wrong endpoints)
- [ ] Remove all `console.log` from production code
- [ ] Standardize API response format to `{ data, meta?, error? }`
- [ ] Add Zod validation to all PATCH/POST routes missing it
- [ ] Fix Companies POST dropping 11 of 20 fields — Issue #1080

---

## Phase 2: Activate SaaS Features (Weeks 2-3)

### Public Marketing Site

- [ ] Build `/` landing page (hero, features, CTA)
- [ ] Build `/pricing` page with plan comparison
- [ ] Build `/signup` page with trial signup
- [ ] Build `/login` page
- [ ] Build `/docs` API documentation page
- [ ] Add SEO meta tags, sitemap.xml, robots.txt

### Stripe Integration (Already 80% Built)

- [ ] Connect Stripe webhooks properly (already have route)
- [ ] Build subscription management UI
- [ ] Build invoice list and detail pages
- [ ] Add payment method update flow
- [ ] Add trial expiry handling
- [ ] Build upgrade/downgrade flow

### Onboarding Flow

- [ ] Build setup wizard (`/setup`)
- [ ] Industry template selection
- [ ] Import data from CSV
- [ ] Invite team members
- [ ] Connect email provider

### Email Templates

- [ ] Welcome email
- [ ] Trial expiry reminder
- [ ] Payment failed notification
- [ ] Password reset
- [ ] Team invite email

---

## Phase 3: Differentiate (Weeks 4-6)

### Pick a Niche

Decide which industry to target:

- [ ] Real Estate CRM?
- [ ] Healthcare CRM?
- [ ] Agency CRM?
- [ ] E-commerce CRM?
- [ ] SaaS Sales CRM?

### Industry-Specific Modules

- [ ] Custom fields per industry
- [ ] Industry-specific workflows
- [ ] Industry-specific reports
- [ ] Industry-specific templates

### Plugin/Marketplace System

- [ ] Plugin schema already exists (tokens, api_keys)
- [ ] Build plugin install/uninstall flow
- [ ] Build plugin marketplace UI
- [ ] Add plugin billing (revenue share)

### AI Features

- [ ] AI provider system already exists (OpenAI, Anthropic, Groq)
- [ ] Build AI lead scoring
- [ ] Build AI email composer
- [ ] Build AI activity summary
- [ ] Build AI deal insights

---

## Phase 4: Scale (Weeks 7-12)

### Multi-Region

- [ ] Add read replicas for database
- [ ] Add CDN for static assets
- [ ] Add edge functions for API

### Advanced Features

- [ ] Custom domains per tenant
- [ ] White-label email sending
- [ ] SSO/SAML integration
- [ ] Advanced RBAC with custom roles
- [ ] Audit log export

### Monitoring & Observability

- [ ] Start Prometheus/Grafana stack — Issue #1044
- [ ] Add Sentry error tracking — Issue #1039
- [ ] Add APM tracing
- [ ] Build status page

### Security Hardening

- [ ] Fix all 88 issues from audit
- [ ] Add rate limiting to all endpoints
- [ ] Add IP whitelisting
- [ ] Add 2FA for admin
- [ ] SOC2 compliance preparation

---

## Tech Stack (No Changes Needed)

| Component  | Technology            | Status              |
| ---------- | --------------------- | ------------------- |
| Frontend   | Next.js 16 + React 19 | ✅ Production ready |
| Backend    | Next.js API Routes    | ✅ Production ready |
| Database   | PostgreSQL 16         | ✅ Production ready |
| ORM        | Drizzle               | ✅ Production ready |
| Cache      | Redis 7               | ✅ Production ready |
| Queue      | BullMQ + pg-boss      | ✅ Production ready |
| Storage    | S3/MinIO              | ✅ Production ready |
| Auth       | JWT + Sessions        | ✅ Production ready |
| Billing    | Stripe                | ✅ 80% complete     |
| Email      | Resend                | ✅ Production ready |
| AI         | Multi-provider        | ✅ Production ready |
| Monitoring | Prometheus/Grafana    | ✅ Ready to deploy  |

---

## Key Metrics to Track

| Metric                  | Target               |
| ----------------------- | -------------------- |
| MRR                     | $10K within 6 months |
| Active tenants          | 100 within 3 months  |
| Trial → Paid conversion | 15%+                 |
| Churn rate              | <5% monthly          |
| API response time       | <200ms p95           |
| Uptime                  | 99.9%+               |

---

## Summary

**DO NOT rebuild. The backbone is solid.**

| What            | Action                           |
| --------------- | -------------------------------- |
| Database        | Keep as-is                       |
| Tech stack      | Keep as-is                       |
| CRM core        | Fix bugs, activate features      |
| SaaS layer      | Build marketing site + Stripe    |
| Differentiation | Pick niche, add industry modules |

**Timeline:** 12 weeks to launch MVP with paying customers.
**Effort:** ~200-300 hours of focused development.
**Risk:** Low — most infrastructure is built and tested.

---

**Last updated:** 2026-08-06
**Assigned to:** Vinayak (final approval required)
**Target year:** 2027
