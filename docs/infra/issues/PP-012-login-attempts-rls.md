# `login_attempts` RLS blocks writes and reads — brute-force lockout is silently disabled (PP-012)

**Severity:** CRITICAL — security control not functioning
**Area:** Security / auth / tenant isolation · Data integrity
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-012](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)
**Sentry:** `NUCRM-5` / `NUCRM-4` — `POST /api/auth/login`

## Summary

Every failed login raises `new row violates row-level security policy for table "login_attempts"`
(from `lib/security/brute-force.ts::recordFailedAttempt`). The error is caught and swallowed, so login
still returns "invalid credentials". Worse: **reads of `login_attempts` return 0 rows silently, so the
`maxAttempts` counters never reach their threshold and IP/email lockout never fires** — brute-force
protection is disabled while the UI suggests it is working.

## Steps to reproduce

1. `POST /api/auth/login` with a wrong password a few times — the HTTP response is a normal 401.
2. Observe `NUCRM-5` in Sentry, pointing at `lib/auth/api-handlers.ts:POST_login:125` →
   `lib/security/brute-force.ts:recordFailedAttempt:116`.
3. Confirm the read half (no error, always 0):

```sql
-- as the app role
SELECT count(*) FROM login_attempts;   -- 0, even after failed logins
```

## Expected vs actual

- **Expected:** the failed attempt is recorded and repeated failures trigger lockout.
- **Actual:** the write errors (swallowed) and the read returns nothing — lockout thresholds are never met.

## Why

`login_attempts` is `rls=true forced=true` with one policy
`login_attempts_super_admin_only`: `FOR ALL USING (current_setting('app.is_super_admin', true)::boolean = true)`
and **no `WITH CHECK`**. For INSERT, PostgreSQL reuses the `USING` expression as the check, and the
recorder runs before any session exists, so `app.is_super_admin` is NULL → the row is rejected. Reads are
simply filtered to zero rows. The table has no `tenant_id` at all — it is a global pre-auth audit table
that this policy was never designed for.

## File / route

- `lib/security/brute-force.ts` (lines ~80-160), `lib/auth/api-handlers.ts` (`POST_login`)
- `drizzle/migrations/0054_rls_phase0.sql` (`login_attempts_super_admin_only`)

## Proposed fix

Add explicit pre-auth policies:

```sql
CREATE POLICY login_attempts_insert_preauth ON login_attempts FOR INSERT WITH CHECK (true);
CREATE POLICY login_attempts_read_preauth   ON login_attempts FOR SELECT USING (true);
```

The read policy is required for the counters to work at all. Also stop swallowing the error silently
(or count/report the failures) so a regression like this surfaces immediately.
