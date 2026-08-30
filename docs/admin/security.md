# Security & Compliance

The platform-operator view of NuCRM's security model. For the workspace-admin view, see
[Public → Security Settings](../public/admin-guide/security-settings.md).

> Companion references: [`docs/database-security.md`](../database-security.md),
> [`docs/TENANT-ISOLATION-VERIFICATION.md`](../TENANT-ISOLATION-VERIFICATION.md),
> [`docs/SECURITY-ANALYSIS.md`](../SECURITY-ANALYSIS.md), and the ADRs in [`docs/adr/`](../adr/README.md).

---

## Authentication

| Mechanism | Implementation |
| --- | --- |
| **Sessions** | JWT (HS256 via `jose`, signed with `JWT_SECRET`), stored in an **http-only, `SameSite=strict`, Secure** cookie `nucrm_session` (30-day default). Source: `lib/auth/session.ts`. |
| **Session records** | A DB `sessions` row stores a **SHA-256 hash** of the token; a session is only valid while its row exists and is unexpired (enables revocation). |
| **Passwords** | **bcrypt** hashing, minimum length + complexity enforced. |
| **API keys** | Server-to-server auth; each key is tenant-scoped and revocable. `lib/auth/api-key.ts`. |
| **2FA** | TOTP (`lib/auth/totp.ts`). |
| **SSO** | SAML 2.0 (`@node-saml`, signature-verified, XSW-hardened, email-domain allowlist), OIDC (JWKS-verified via `jose`), OAuth 2.0. `lib/auth/sso.ts`. |
| **SCIM** | SCIM 2.0 provisioning at `app/api/scim/v2`. |

The central request gate is **`requireAuth()`** in
[`lib/auth/middleware.ts`](../../lib/auth/middleware.ts): it tries API-key auth, then JWT
(Bearer/cookie), caches auth context per token but **re-validates membership/role on cache hits**
so revocations take effect promptly.

---

## Authorization (RBAC)

- **Permissions** are `resource.action` pairs defined in
  [`lib/permissions/definitions.ts`](../../lib/permissions/definitions.ts), grouped by category and
  tagged with danger levels.
- **Default roles:** `admin`, `manager`, `sales_rep`, `viewer`; workspaces can define **custom
  roles** (stored in the `roles` table with a JSONB permission set).
- Enforcement helpers: `can()`, `requirePerm()`, `requireModule()`, `requireFeature()`.
- **Fine-grained control:** field-level and record-level permissions in `lib/rbac`.
- **Super-admins** are granted platform-wide access and bypass tenant membership — a deliberately
  privileged path that is fully audited.

---

## Tenant isolation (critical)

Two enforced layers — **never** rely on only one:

1. **Application** — `tenant_id` filtering via the authenticated context.
2. **Database RLS** — `setTenantContext()` in [`lib/db/rls.ts`](../../lib/db/rls.ts) sets
   `app.current_tenant` / `app.current_user`; RLS policies restrict rows to the current tenant.
   `verifyAllRLSEnabled()` audits that critical tables have RLS on.

**PgBouncer (transaction mode):** session GUCs persist on a pooled connection and are cleared by
`DISCARD ALL`. Request-scoped connection pinning keeps `setTenantContext` and the query together.
Additional guards live in `lib/db/tenant-isolation-guard.ts`.

> Verify isolation regularly: `npm run db:verify-isolation`. See
> [`docs/TENANT-ISOLATION-VERIFICATION.md`](../TENANT-ISOLATION-VERIFICATION.md).

---

## Cross-cutting protections

| Control | Where |
| --- | --- |
| **CSRF** (double-submit) on cookie-based mutations | `lib/auth/csrf.ts` |
| **Rate limiting** (tiered per endpoint) | `lib/rate-limit*.ts` |
| **Brute-force protection** (login attempts/blocks) | login flow + DB tables |
| **Field-level encryption** | `lib/field-encryption.ts`, `lib/crypto.ts` |
| **Data Loss Prevention (DLP)** | `lib/dlp.ts` |
| **IP allowlist** | `lib/ip-whitelist.ts` |
| **SSRF guard** (plugin/outbound fetch) | `lib/security/ssrf.ts` |
| **SQL allowlist** (data explorer) | `lib/sql-allowlist.ts` |
| **Input sanitization** (XSS) | DOMPurify + `lib/sanitize.ts` |
| **Audit logging** | `lib/audit.ts`, `lib/audit/`; super-admin actions → `super_admin_audit_logs` |
| **PII scrubbing in error reports** | `sentry-pii-scrub.ts` |

---

## Compliance

- **GDPR** — data subject requests, right to deletion, data portability (`lib/compliance/`).
- **SOC2-aligned practices** — audit trails, access controls, security monitoring.
- **Data retention** — configurable retention policies with automated cleanup.
- **Impersonation** — always recorded with a full audit trail.

---

## Operator security checklist

- [ ] Strong, unique `JWT_SECRET`, `SESSION_SECRET`, `SETUP_KEY`, `CRON_SECRET`, `ENCRYPTION_KEY`.
- [ ] `DATABASE_SSL=true`; database not publicly reachable.
- [ ] `TRUST_PROXY=true` **only** behind nginx/Vercel; app ports bound to loopback.
- [ ] RLS enabled on all tenant tables (`db:verify-isolation` passes).
- [ ] `METRICS_SECRET` set; `/api/metrics` not publicly open.
- [ ] Cron endpoints protected (`CRON_SECRET`, optionally `CRON_ALLOWED_IPS` / `CRON_SIGNING_KEY`).
- [ ] Backups encrypted (`BACKUP_ENCRYPTION_KEY`) and verified — see [Backups & DR](./backups-dr.md).
- [ ] Sentry PII scrubbing active; secrets never logged or committed.

---

## Related

- [Architecture → Multi-tenancy](./architecture.md#multi-tenancy-defense-in-depth)
- [Configuration Reference](./configuration.md)
- [Super-Admin Console](./superadmin-console.md)
