# Tenant-isolation gate FAILED: 5 tables without RLS, 10 without a policy, 6 NULL-tenant leaks (PP-013)

**Severity:** CRITICAL — tenant isolation gap
**Area:** Security / auth / tenant isolation · Data integrity
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-013](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)
**Gate:** `npx tsx scripts/verify-tenant-isolation.ts` → exit code non-zero

## Summary

The RLS isolation gate fails on three distinct classes of gap. With the app role neither superuser nor
`BYPASSRLS` and 193 tables under `FORCE ROW LEVEL SECURITY`, these policies *are* the isolation boundary —
a missing policy is either a cross-tenant leak or a broken feature.

```
tables with tenant_id    : 194   (uuid: 193, another type: 1)
RLS enabled              : 188/193
tenant_isolation policy  : 183/193
FORCE ROW LEVEL SECURITY : 193/193

RLS DISABLED on 5 table(s):
  analytics_events, custom_entities, custom_entity_data, webhook_events, webhook_field_mappings
NO tenant_isolation policy on 10 table(s):
  analytics_events, contact_emails, custom_entities, custom_entity_data, hierarchy_permissions,
  price_book_entries, usage_alerts, webhook_events, webhook_field_mappings, webhook_queue
Policy admits NULL tenant_id on 6 table(s) with a nullable tenant_id — readable by EVERY tenant:
  backup_schedules, error_logs, lead_warming_events, oauth_clients, platform_settings, security_events
RESULT: gaps found
```

## Steps to reproduce

```bash
cd /srv/nucrm && npx tsx scripts/verify-tenant-isolation.ts
# also list a table's posture:
# SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, p.polname,
#        pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
# FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid WHERE c.relname = 'webhook_events';
```

## Expected vs actual

- **Expected:** the gate exits 0 — every tenant-scoped table has RLS enabled, `FORCE` set, a
  `tenant_isolation` policy, and no NULL-tenant rows visible across tenants.
- **Actual:** `RESULT: gaps found`.

## Why

Tables added after the original RLS phases never received policies (`custom_entities`,
`custom_entity_data`, `analytics_events`, `webhook_events` from migration `0087`,
`webhook_field_mappings`), and the nullable-`tenant_id` tables were given a policy that treats `NULL`
as "visible to everyone".

## File / route

- `drizzle/migrations/0068_*` (FORCE RLS), `drizzle/migrations/0054_rls_phase0.sql` … `0087_webhook_events.sql`
- `scripts/verify-tenant-isolation.ts`

## Proposed fix

One follow-up migration that, per table, enables RLS, adds the standard `tenant_isolation` policy (with
the `NULLIF(current_setting(...), '')` guard used in `0054`) and tightens the six nullable-`tenant_id`
policies so `NULL` does not mean "everyone". Note `super_admin_audit_logs.tenant_id` is `text`, so it
needs a `::text` variant (see PP-022). Re-run the gate afterwards.
