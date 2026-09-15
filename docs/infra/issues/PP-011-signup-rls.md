# Public signup rejected by RLS (`users_insert_auth` unsatisfiable pre-auth) (PP-011)

**Severity:** CRITICAL — core feature broken
**Area:** Security / auth / tenant isolation · API
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-011](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)
**Sentry:** `NUCRM-2` / `NUCRM-3` — `POST /api/auth/signup`

## Summary

Self-service signup can never succeed while RLS is enabled: the INSERT into `users` is refused before any
session or GUC exists. The feature is gated by the `allow_signups` platform setting, but with that
setting enabled the request still fails — as a server error, not a friendly "signups are disabled".

## Steps to reproduce

1. Enable signups (`allow_signups = true`) and `POST /api/auth/signup` with a valid body.
2. Observe the error in Sentry (`NUCRM-3`) and the `app` log: `new row violates row-level security policy
   for table "users"`, `insert into "users" (...)`.
3. Same reproducer as PP-010 (an `INSERT INTO users` with no GUC set).

## Expected vs actual

- **Expected:** a new user row is created and the signup flow proceeds.
- **Actual:** `new row violates row-level security policy for table "users"`.

## Why

Same root cause as PP-010 — `users_insert_auth` requires `current_setting('app.current_user') <> ''`,
which is only set post-authentication. Signup is pre-auth by definition, so the policy is unsatisfiable.

## File / route

- `lib/auth/api-handlers.ts`, `app/api/auth/signup/route.ts`
- `drizzle/migrations/0054_rls_phase0.sql` (`users_insert_auth`)

## Proposed fix

Cover the signup INSERT with the bootstrap policy from PP-010, or route signup through an audited
privileged path. Decide once for both flows so the two paths cannot drift apart again.
