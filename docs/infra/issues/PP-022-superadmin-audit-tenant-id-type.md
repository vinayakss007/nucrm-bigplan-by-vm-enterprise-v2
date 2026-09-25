# `super_admin_audit_logs.tenant_id` is `text`, so the standard RLS policy can't apply (PP-022)

**Severity:** LOW — blocks one table from the standard policy template
**Area:** Data integrity (DB, migrations) · Security / tenant isolation
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-022](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

`super_admin_audit_logs.tenant_id` is `text` while every other tenant-scoped table uses `uuid`. The
isolation gate flags it explicitly ("tenant_id present but NOT uuid — cannot use the standard policy"),
which is why the tenant-scoped table count (194) and the `uuid`-scoped count (193) differ. The standard
`tenant_isolation` policy cannot be applied to it verbatim.

## Steps to reproduce

```bash
cd /srv/nucrm && npx tsx scripts/verify-tenant-isolation.ts
#   tables with tenant_id : 194   (uuid: 193, another type: 1)

# or directly:
# SELECT table_name, data_type FROM information_schema.columns
# WHERE column_name = 'tenant_id' AND data_type <> 'uuid';
```

## Expected vs actual

- **Expected:** `tenant_id` is `uuid` on every tenant-scoped table, so one policy template covers all of
  them.
- **Actual:** `super_admin_audit_logs.tenant_id` is `text` and is skipped by the standard template.

## Why

The table was created with a free-form `text` tenant reference (super-admin audit entries also record
`NULL` for platform-level actions), so a plain `tenant_id = current_setting('app.current_tenant')::uuid`
policy does not typecheck.

## File / route

- `drizzle/schema/*` (`superAdminAuditLogs`), `drizzle/migrations/0054_rls_phase0.sql` and later
- `scripts/verify-tenant-isolation.ts`

## Proposed fix

Handle it in the same migration as PP-013, as either:

1. a `::text`-cast variant of the standard policy
   (`tenant_id = current_setting('app.current_tenant', true)`), keeping the column type; or
2. a deliberate column-type change to `uuid` (with a data migration for existing rows), which removes the
   special case entirely.

Whichever is chosen, the verifier should stop reporting the mismatch and the gate's two counts should
agree — otherwise the exclusion stays invisible and the next table with a non-`uuid` `tenant_id` will be
missed the same way.
