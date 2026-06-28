# NuCRM Enterprise - Deep Architecture & Security Audit

> **Audit Date:** June 28, 2026
> **Auditor:** opencode (AI Systems Architect)
> **Severity Scale:** CRITICAL > HIGH > MEDIUM > LOW

---

## Executive Summary

**Security posture: MODERATE-GOOD with critical gaps.**

The application has extensive security measures (RLS, CSRF, brute-force protection, rate limiting, field encryption, bcrypt). However, **critical vulnerabilities exist** in the SSO implementation, and real secrets exist on disk in `.env.local`. Infrastructure lacks TLS and Redis authentication.

---

## 1. CRITICAL FINDINGS (Security Risks)

### C1. REAL SECRETS COMMITTED TO `.env.local`

**File:** `/home/vinayak_shruti_biz/nucrm-enterprise/.env.local`

```
JWT_SECRET=1s7C//kD5xuYI1Ux79OVRiX7S+UP2TTmhPQga18m+jT0I8qkjTzJmYHiY++ukfvn2B5Fjne4ew3E+UXcw2WW5Q==
SESSION_SECRET=XQXji9fi3MDH8MMXdHJyZq3gY0W1sVk5NhaQRQhYaIqFcB74jE6s298d8qPFPjpL
SETUP_KEY=c6b14fc218baa8bf57453018ac8461feb0e96c03c8ed3daa12f88f75536b2c56
CRON_SECRET=i1JHoHOeoxd8z5MXjIeCQuPceZeWm4sfgNMXz7Q/M/ypnrRGQcjHnIgwf4G/DaVjOobyxxECrCLJzCyiDc7Vsg==
ENCRYPTION_KEY=1c5c991ac1ba0d43e6f9ba416219957c7c47052abf0c5343449cbc4a173b6e36
GRAFANA_ADMIN_PASSWORD=admin
DATABASE_URL=postgresql://nucrm:nucrm123@localhost:5432/nucrm
```

**Issues:**
- GRAFANA password is trivially weak: `admin`
- Database password: `nucrm123`
- All JWT/session signing secrets visible on disk
- `.gitignore` lists `.env.local` but file exists with real values

**Action:** Rotate ALL secrets immediately.

---

### C2. SAML SSO - NO SIGNATURE VERIFICATION

**File:** `lib/auth/sso.ts:146-155`

```typescript
// WARNING: This is a simplified SAML implementation that does NOT verify
// the XML signature against the IdP certificate. Production deployments
// MUST use a proper SAML library...
samlAssertion = params.SAMLResponse;
```

**Risk:** Attacker can forge arbitrary SAML assertions to impersonate any user.

---

### C3. OIDC LEGACY PATH - NO JWT SIGNATURE VERIFICATION

**File:** `lib/auth/sso.ts:182-184`

```typescript
const parts = idToken.split('.');
const payload = JSON.parse(Buffer.from(parts[1] || '', 'base64').toString());
email = payload.email as string;
```

**Risk:** Token forgery possible. The newer `lib/auth/sso/oidc.ts` module properly verifies JWT signatures via JWKS, but this legacy path does not.

---

### C4. CRON_SECRET TIMING-UNSAFE COMPARISON

**File:** `lib/auth/cron.ts`

```typescript
return cronSecret === process.env.CRON_SECRET;
```

**Risk:** Uses `===` instead of timing-safe `verifySecret()` from `lib/crypto.ts`. Timing side-channel attack possible.

---

### C5. STRIPE SIGNATURE VERIFICATION BUG

**File:** `lib/stripe.ts:344,351-357`

`timingSafeEqual` returns `false` early if lengths differ, leaking timing information. Should pad to equal length like `lib/crypto.ts` does.

---

### C6. SQL INJECTION RISK IN `getApiKeyUsage`

**File:** `lib/auth/api-key.ts:182`

```typescript
gt(apiKeyUsage.createdAt, sql`now() - interval '${sql.raw(days.toString())} days'`)
```

`sql.raw()` bypasses parameterization. Same pattern in `lib/webhooks/delivery.ts:226`.

---

## 2. IMPORTANT FINDINGS (Architectural Concerns)

### I1. NO SSL/TLS IN NGINX OR DOCKER-COMPOSE

Both `infra/nginx/nginx.conf` and `nginx.conf` have SSL commented out. All traffic (JWT, passwords, API keys) in plaintext.

### I2. REDIS HAS NO AUTHENTICATION

**File:** `docker-compose.yml`

```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --maxmemory 256mb
    --maxmemory-policy allkeys-lru
```

Any container on `nucrm-net` network can read/write Redis data (BullMQ queues, rate limits, sessions).

### I3. POSTGRES EXPOSED ON HOST PORT 5432

```yaml
ports:
  - "${POSTGRES_PORT:-5432}:5432"
```

Combined with weak password `nucrm123`, significant risk in non-isolated environments.

### I4. PGBOUNCER TRANSACTION MODE

`POOL_MODE=transaction` can break features relying on `SET` statements persisting across statements. RLS context is set correctly with `is_local=true`, but the in-connection pool in `lib/db/pool.ts` does NOT use PgBouncer by default.

### I5. EDGE RATE LIMITER IS PER-ISOLATE IN-MEMORY

`EdgeRateLimiter` in `lib/rate-limit-edge.ts` uses in-memory `Map`. With multiple serverless edge instances, rate limits are multiplied by instance count.

### I6. BULLMQ WORKER SHARES DATABASE WITH APP

Worker process in `worker.ts` uses same DB pool as web application. If worker pool leaks, it affects web requests.

### I7. EVAL() USED IN REDIS LOCK SCRIPT

**File:** `lib/cache/index.ts:189` - Redis `EVAL` for distributed locking. Standard pattern but needs proper fencing tokens and lease expiry.

### I8. DOCKERFILE BUILDS WITH `--legacy-peer-deps`

```dockerfile
RUN npm install --legacy-peer-deps --no-audit --no-fund
```

Bypasses peer dependency checks, potentially installing incompatible packages.

### I9. SENTRY `hideSourceMaps: true`

Good for security but build process still emits source maps in `.next` directory.

### I10. ALLOWED_ORIGINS INCLUDES GCP IP ADDRESSES

```
ALLOWED_ORIGINS=http://localhost:3000,http://34.58.9.237:3000,http://34.123.152.161:3000
```

If instances decommissioned, origins should be removed.

---

## 3. DEPENDENCY INVENTORY

### Production Dependencies (40)

| Package | Purpose | Risk |
|---------|---------|------|
| `next` 16.2.6 | Framework | Core |
| `react` 19.2.4 | UI library | Core |
| `drizzle-orm` + `drizzle-kit` | Database ORM + migrations | Low |
| `pg` | PostgreSQL driver | Low |
| `ioredis` 5.10.1 | Redis client | Low |
| `bullmq` 5.77.6 | Job queue (Redis-backed) | Low |
| `jose` 6.2.2 | JWT signing/verification | Low |
| `bcryptjs` 3.0.3 | Password hashing | Low |
| `zod` 4.4.3 | Schema validation | Low |
| `@aws-sdk/client-s3` | S3/R2 storage | Low |
| `nodemailer` 8.0.9 | SMTP email | Low |
| `resend` 4.8.0 | Resend email API | Low |
| `dompurify` 3.4.4 | XSS sanitization | Low |
| `@sentry/nextjs` 10.47.0 | Error tracking | Low |
| `mathjs` 14.9.1 | Formula evaluation | **Medium** |
| `qrcode` 1.5.4 | QR code generation (TOTP) | Low |
| `react-markdown` + `remark-gfm` | Markdown rendering | **Medium** |

### Dev Dependencies (16)

| Package | Purpose | Risk |
|---------|---------|------|
| `playwright` + `@playwright/test` | E2E testing | Low |
| `vitest` 2.1.8 | Unit testing | Low |
| `lighthouse` | Performance audit | Low |
| `concurrently` | Parallel script runner | Low |

---

## 4. AUTO-GENERATED CODE

- **30 migration files** in `drizzle/migrations/` (auto-generated by Drizzle Kit)
- **39 schema files** in `lib/db/schema/` (well-managed)
- **10 cron jobs** in `vercel.json` (properly protected by CRON_SECRET)

---

## 5. EXTERNAL SERVICES

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Resend | `https://api.resend.com/emails` | Transactional email |
| Stripe | `https://api.stripe.com/v1` | Payment processing |
| Facebook Graph | `https://graph.facebook.com/v17.0/` | WhatsApp messaging |
| Twilio | `https://api.twilio.com/2010-04-01` | Voice/SMS |
| OpenAI | `https://api.openai.com/v1` | AI features |
| Telegram | `https://api.telegram.org/bot*/sendMessage` | Notifications |
| Discord | Discord webhook URLs | Ops alerts |
| Slack | Slack webhook URLs | Ops alerts |
| Sentry | Sentry ingest endpoints | Error tracking |
| Grafana/Loki | OTLP endpoint + `/loki/api/v1/push` | Metrics and logs |
| OIDC IdPs | Dynamic discovery URLs | SSO |
| S3/R2 | Configured endpoint | Object storage |

---

## 6. SECURITY MEASURES IN PLACE

1. ✅ JWT Authentication (HS256, 30-day expiry, session table)
2. ✅ CSRF Protection (Double Submit Cookie)
3. ✅ Rate Limiting (edge + application)
4. ✅ Brute Force Protection (5 attempts / 15 min = 30 min block)
5. ✅ Row-Level Security (RLS) with `set_config()`
6. ✅ Password Policy (12+ chars, uppercase, number, special)
7. ✅ bcrypt with 12 rounds
8. ✅ AES-256-GCM encryption for sensitive data
9. ✅ DOMPurify sanitization
10. ✅ SQL injection prevention (parameterized queries)
11. ✅ Security headers (HSTS, CSP, X-Frame-Options)
12. ✅ Timing-safe comparisons (in `lib/crypto.ts`)
13. ✅ Environment validation at startup
14. ✅ 2FA/TOTP support
15. ✅ OIDC SSO (newer path)
16. ✅ Webhook signature verification (HMAC-SHA256)
17. ✅ Email enumeration prevention
18. ✅ IP whitelisting per tenant
19. ✅ Audit logging with super admin trail
20. ✅ CORS validation

---

## 7. RECOMMENDATIONS

### P0 - Do Now

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | Rotate ALL secrets | `.env.local` | JWT_SECRET, SESSION_SECRET, SETUP_KEY, CRON_SECRET, ENCRYPTION_KEY, DB password, Grafana password |
| 2 | Fix SAML signature verification | `lib/auth/sso.ts` | Use `@node-saml/node-saml` or remove SAML |
| 3 | Fix OIDC legacy path | `lib/auth/sso.ts:182` | Use `lib/auth/sso/oidc.ts` (JWKS verification) |
| 4 | Fix timing-unsafe comparison | `lib/auth/cron.ts` | Use `verifySecret()` from `lib/crypto.ts` |
| 5 | Fix Stripe signature timing | `lib/stripe.ts:351-357` | Pad to equal length before comparison |

### P1 - This Sprint

| # | Issue | File | Fix |
|---|-------|------|-----|
| 6 | Enable TLS | `nginx.conf` | Uncomment SSL, set `COOKIE_SECURE=true` |
| 7 | Secure Redis | `docker-compose.yml` | Add `requirepass` |
| 8 | Remove PG port exposure | `docker-compose.yml` | Restrict to `127.0.0.1:5432:5432` |
| 9 | Fix `sql.raw()` injection | `lib/auth/api-key.ts:182` | Use Drizzle parameterized SQL |
| 10 | Remove `--legacy-peer-deps` | `Dockerfile` | Fix peer conflicts properly |

### P2 - Next Quarter

| # | Issue | Fix |
|---|-------|-----|
| 11 | Add Redis authentication | Review BullMQ job payloads |
| 12 | Implement per-plan rate limiting | Configurable system |
| 13 | Add server-side Redis rate limiting | Complement in-memory edge limiter |
| 14 | Review `mathjs` usage | Formula injection risk |
| 15 | Review `react-markdown` usage | Ensure sanitized output |
| 16 | Add SAST/DAST to CI/CD | CodeQL, Snyk |
| 17 | Rotate production credentials | 90-day API keys, 365-day signing secrets |
| 18 | Audit `proxy.ts` PUBLIC_PATHS | Ensure no accidental public routes |

### P3 - Architecture

| # | Issue | Fix |
|---|-------|-----|
| 19 | Separate worker DB connections | Prevent resource contention |
| 20 | Implement secret management vault | HashiCorp Vault, AWS Secrets Manager |
| 21 | Database connection encryption | SSL/TLS to PostgreSQL |
| 22 | SAML assertion encryption | Enterprise customer requirement |
| 23 | Request logging with structured fields | Complement devLogger |

---

## 8. WHAT YOU BUILT vs WHAT'S AUTO-GENERATED

### You Built (Custom)
- All CRM features (contacts, leads, deals, companies, tasks)
- Multi-tenant architecture with RLS
- Authentication system (JWT, SSO, 2FA)
- API key management
- Webhook system (inbound + outbound)
- Super Admin panel
- AI integration layer
- Email tracking
- Document management
- Automation sequences
- Billing system
- Analytics dashboard
- All 39 schema files
- All API routes

### Auto-Generated
- Drizzle migration files (30 files)
- Next.js build output
- Node modules
- Playwright test artifacts

### Third-Party Services (You Connect To)
- PostgreSQL (database)
- Redis (cache + queues)
- S3/R2 (file storage)
- Resend (email)
- Stripe (payments)
- OpenAI (AI)
- Twilio (SMS/Voice)
- Facebook Graph API (WhatsApp)
- Sentry (error tracking)
- Grafana/Loki (monitoring)

### Infrastructure (You Control)
- Docker Compose (local dev)
- Nginx (reverse proxy)
- PgBouncer (connection pooling)
- BullMQ (background jobs)

---

## 9. POTENTIAL RISKS IF APP RUNS WITHOUT YOUR CONTROL

1. **Secrets exposure** - `.env.local` has all credentials in plaintext
2. **SSO bypass** - SAML/OIDC tokens can be forged (no signature verification)
3. **Cross-tenant access** - If RLS disabled or DB admin bypasses it
4. **Data exfiltration** - No DLP controls on API exports
5. **Supply chain** - `--legacy-peer-deps` may install vulnerable packages
6. **Monitoring blind spots** - Source maps hidden but still in build output

---

## 10. CONCLUSION

The application is **well-built with strong security fundamentals** but has **critical gaps in SSO implementation and secrets management**. The architecture is sound (multi-tenant RLS, proper auth flow, rate limiting, encryption). 

**Immediate action required:**
1. Rotate all secrets
2. Fix SAML/OIDC signature verification
3. Enable TLS
4. Secure Redis

**After these fixes, the application is production-ready.**