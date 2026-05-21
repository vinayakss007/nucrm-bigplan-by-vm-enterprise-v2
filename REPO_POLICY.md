# NuCRM Repository Policy

## Three Repos, Three Roles

| Repo | Role | Version |
|------|------|---------|
| `nucrm-bigplan` | **BASE VERSION** — Stable core. No new features. Only performance, reliability, security fixes. | v1.0.0 |
| `nucrm-bigplan2` | **FEATURE VERSION** — Gets fixes from bigplan. Adds new features. Can port fixes back to bigplan. | v1.1.0+ |
| `nucrm-enterprise` | **FULL CLONE + NEW FEATURES** — Gets fixes from bigplan AND bigplan2. Has its own enterprise features. | v2.0.0+ |

## Core Logic

**bigplan = the foundation.**
- Only performance fixes (query optimization, indexes, caching, bundle size)
- Only reliability fixes (crash fixes, error handling, race conditions, memory leaks)
- Only security fixes (vulnerabilities, auth bugs, data leaks)
- NO new features — no new pages, no new components, no new integrations
- NO experiments — no unproven changes

**bigplan2 = the feature layer.**
- Receives ALL proven fixes from bigplan
- Adds new features (AI, SQL export, audit logs, CRUD routes, loading states, etc.)
- If something breaks in bigplan2 → bigplan is unaffected
- Fixes from bigplan2 can go to enterprise

**enterprise = the full product.**
- Receives ALL fixes from bigplan AND bigplan2
- Adds enterprise-only features (SSO, advanced compliance, white-label, etc.)
- If something breaks in enterprise → bigplan and bigplan2 are unaffected

## Sync Rules (STRICT)

### bigplan → bigplan2 (ALWAYS allowed)
- ✅ Performance fixes
- ✅ Reliability fixes
- ✅ Security fixes
- ✅ CI/CD fixes
- ✅ Docker/build fixes
- ✅ Deployment infrastructure

### bigplan → enterprise (ALWAYS allowed)
- ✅ Everything from bigplan

### bigplan2 → enterprise (ALWAYS allowed)
- ✅ Performance fixes from bigplan2
- ✅ Reliability fixes from bigplan2
- ✅ Security fixes from bigplan2
- ✅ New features from bigplan2

### bigplan2 → bigplan (ONLY these)
- ✅ Performance fixes that originated in bigplan2
- ✅ Reliability fixes that originated in bigplan2
- ✅ Security fixes that originated in bigplan2
- ❌ NO new features from bigplan2

### enterprise → bigplan2 (ONLY these)
- ✅ Performance fixes that originated in enterprise
- ✅ Reliability fixes that originated in enterprise
- ✅ Security fixes that originated in enterprise
- ❌ NO new features from enterprise

### enterprise → bigplan (ONLY these)
- ✅ Performance fixes that originated in enterprise
- ✅ Reliability fixes that originated in enterprise
- ✅ Security fixes that originated in enterprise
- ❌ NO new features from enterprise

## Data Flow Diagram

```
bigplan (BASE)
  │
  ├─── fixes ───→ bigplan2 (FEATURES)
  │                    │
  │                    ├─── fixes + features ───→ enterprise (FULL)
  │
  └─── fixes ───────────────────────────────→ enterprise (FULL)

NEVER flows backwards:
  enterprise ─X─→ bigplan2 (no features)
  enterprise ─X─→ bigplan (no features)
  bigplan2 ─X─→ bigplan (no features)
```

## Examples

| Change | Direction | Allowed? |
|--------|-----------|----------|
| Dashboard query optimization | bigplan → bigplan2 | ✅ Performance |
| Redis caching | bigplan → bigplan2 | ✅ Performance |
| Zod validation on APIs | bigplan → bigplan2 | ✅ Reliability |
| Dockerfile build fix | bigplan → bigplan2 | ✅ Reliability |
| CI env vars fix | bigplan → bigplan2 | ✅ CI/CD |
| Flexible AI system | bigplan2 → enterprise | ✅ Feature |
| SQL export | bigplan2 → enterprise | ✅ Feature |
| Loading states on 40+ pages | bigplan2 → enterprise | ✅ Feature |
| SSO integration | enterprise only | ✅ Enterprise feature |
| White-label branding | enterprise only | ✅ Enterprise feature |
| AI system | bigplan2 → bigplan | ❌ New feature |
| SQL export | bigplan2 → bigplan | ❌ New feature |
| SSO | enterprise → bigplan2 | ❌ New feature |

## Golden Rule
**bigplan is the foundation. It never gets new features. bigplan2 builds on bigplan with features. enterprise builds on both with enterprise features. Fixes flow upward. Features never flow backward.**

## Before Any Change, Ask:
1. Which repo?
2. Is this a fix or a new feature?
3. If sending to another repo: is it ONLY a fix (performance/reliability/security)?

If the answer doesn't match → **do not make the change.**

## Super Admin Tenant Management

Super admin MUST have full control over any tenant from the monitoring dashboard:
- View any tenant's usage, modules, settings
- Override limits for any tenant
- Force-enable/disable modules for any tenant
- Impersonate any tenant admin
- View per-user breakdown within any tenant
- Manually reset counters

This is implemented in:
- `app/superadmin/tenants/[id]/` — full tenant management
- `app/superadmin/monitoring/` — global monitoring dashboard
- `app/superadmin/modules/` — module management across all tenants
- `app/superadmin/plans/` — plan limits management
