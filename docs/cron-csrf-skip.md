# Cron Job CSRF Exemption

## Why cron endpoints skip CSRF

Cron job endpoints (`/api/cron/*`) are exempt from CSRF validation in `lib/auth/csrf.ts:needsCsrfValidation()`.

### Rationale

1. **No browser context** — Cron jobs are invoked server-to-server by Vercel Cron Jobs, GitHub Actions, or the internal scheduler. There is no browser session, no DOM, and no user interaction.

2. **Authentication via shared secret** — Each cron request carries a `CRON_SECRET` header that is verified against the server-side secret. This provides equivalent or stronger security guarantees than CSRF tokens.

3. **Idempotency** — All cron handlers are designed to be idempotent. Even if a request were replayed, it would not produce side effects beyond what a single legitimate execution would.

4. **No session cookies** — Cron requests do not carry user session cookies, so the CSRF threat model (attacker making the victim's browser send a forged request with cookies) does not apply.

### Security controls

| Control | Implementation |
|---------|---------------|
| Shared secret | `CRON_SECRET` env var, validated in each cron handler |
| Rate limiting | Cron routes are subject to global rate limiting |
| IP allowlisting | Vercel Cron Jobs use known IP ranges (optional) |
| Audit logging | All cron executions are logged with result status |

### Related code

- `lib/auth/csrf.ts:needsCsrfValidation()` — the exemption
- `lib/env.ts` — CRON_SECRET validation (minimum 32 characters)
- Individual cron handlers in `app/api/cron/*/route.ts`
