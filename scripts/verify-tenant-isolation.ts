#!/usr/bin/env npx tsx
/**
 * Report the real state of tenant isolation in a live database.
 *
 * Multi-tenant isolation here has two independent halves, and BOTH must hold:
 *
 *   1. Every tenant-scoped table has RLS enabled and a tenant_isolation policy.
 *   2. The role the application connects as is actually SUBJECT to those
 *      policies. A table's owner is exempt from its own RLS unless the table is
 *      marked FORCE ROW LEVEL SECURITY, and a role with BYPASSRLS is always
 *      exempt.
 *
 * Checking only (1) is how a database ends up with 164 policies and zero
 * enforcement. This script checks both and exits non-zero on any gap, so it can
 * be wired into CI or a scheduled audit.
 *
 * Usage:
 *   npm run db:verify-isolation
 *   npm run db:verify-isolation -- --json
 */

import { Pool } from 'pg';

interface TableRow {
  table_name: string;
  tenant_id_type: string | null;
  tenant_id_not_null: boolean | null;
  rls_enabled: boolean;
  rls_forced: boolean;
  has_policy: boolean;
  policy_allows_null_tenant: boolean;
}

const asJson = process.argv.includes('--json');

function log(...args: unknown[]) {
  if (!asJson) console.log(...args);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    // ── Who are we, and can we be constrained at all? ──────────────────────
    const who = await pool.query<{
      current_role: string;
      is_superuser: boolean;
      bypass_rls: boolean;
    }>(`
      SELECT current_user AS current_role,
             rolsuper     AS is_superuser,
             rolbypassrls AS bypass_rls
        FROM pg_roles WHERE rolname = current_user
    `);
    const role = who.rows[0]!;

    // ── Per-table isolation state ─────────────────────────────────────────
    const { rows } = await pool.query<TableRow>(`
      SELECT c.relname                          AS table_name,
             t.typname                          AS tenant_id_type,
             a.attnotnull                       AS tenant_id_not_null,
             c.relrowsecurity                   AS rls_enabled,
             c.relforcerowsecurity              AS rls_forced,
             (p.polname IS NOT NULL)            AS has_policy,
             COALESCE(pg_get_expr(p.polqual, p.polrelid) ILIKE '%tenant_id IS NULL%', false)
                                                AS policy_allows_null_tenant
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attribute a
               ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attisdropped = false
        LEFT JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_policy p
               ON p.polrelid = c.oid AND p.polname = 'tenant_isolation'
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND a.attname IS NOT NULL
       ORDER BY c.relname
    `);

    const tenantScoped = rows.filter((r) => r.tenant_id_type !== null);
    const uuidScoped = tenantScoped.filter((r) => r.tenant_id_type === 'uuid');
    const nonUuidScoped = tenantScoped.filter((r) => r.tenant_id_type !== 'uuid');

    const noPolicy = uuidScoped.filter((r) => !r.has_policy);
    const noRls = uuidScoped.filter((r) => !r.rls_enabled);
    const notForced = uuidScoped.filter((r) => r.rls_enabled && !r.rls_forced);
    const leakyNull = uuidScoped.filter(
      (r) => r.policy_allows_null_tenant && r.tenant_id_not_null === false
    );

    // A policy is only enforced against us if we are neither superuser nor
    // BYPASSRLS, and either we are not the owner or the table forces RLS.
    const roleExempt = role.is_superuser || role.bypass_rls;

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            role,
            roleExempt,
            counts: {
              tenantScoped: tenantScoped.length,
              uuidScoped: uuidScoped.length,
              nonUuidScoped: nonUuidScoped.length,
              missingPolicy: noPolicy.length,
              rlsDisabled: noRls.length,
              notForced: notForced.length,
              leakyNullTenant: leakyNull.length,
            },
            missingPolicy: noPolicy.map((r) => r.table_name),
            rlsDisabled: noRls.map((r) => r.table_name),
            leakyNullTenant: leakyNull.map((r) => r.table_name),
            nonUuidTenantId: nonUuidScoped.map((r) => ({
              table: r.table_name,
              type: r.tenant_id_type,
            })),
          },
          null,
          2
        )
      );
    } else {
      log('\nTenant isolation report');
      log('=======================\n');
      log(`connected as        : ${role.current_role}`);
      log(`superuser           : ${role.is_superuser}`);
      log(`BYPASSRLS           : ${role.bypass_rls}`);
      log('');
      log(`tables with tenant_id        : ${tenantScoped.length}`);
      log(`  ...of type uuid            : ${uuidScoped.length}`);
      log(`  ...of another type         : ${nonUuidScoped.length}`);
      log(`RLS enabled                  : ${uuidScoped.length - noRls.length}/${uuidScoped.length}`);
      log(`tenant_isolation policy      : ${uuidScoped.length - noPolicy.length}/${uuidScoped.length}`);
      log(`FORCE ROW LEVEL SECURITY     : ${uuidScoped.length - notForced.length}/${uuidScoped.length}`);
      log('');

      if (nonUuidScoped.length) {
        log('tenant_id present but NOT uuid (cannot use the standard policy):');
        for (const r of nonUuidScoped) log(`  - ${r.table_name} (${r.tenant_id_type})`);
        log('');
      }
      if (noRls.length) {
        log(`RLS DISABLED on ${noRls.length} tenant-scoped table(s):`);
        for (const r of noRls.slice(0, 25)) log(`  - ${r.table_name}`);
        if (noRls.length > 25) log(`  ... and ${noRls.length - 25} more`);
        log('');
      }
      if (noPolicy.length) {
        log(`NO tenant_isolation policy on ${noPolicy.length} table(s):`);
        for (const r of noPolicy.slice(0, 25)) log(`  - ${r.table_name}`);
        if (noPolicy.length > 25) log(`  ... and ${noPolicy.length - 25} more`);
        log('');
      }
      if (leakyNull.length) {
        log(`Policy admits NULL tenant_id on ${leakyNull.length} table(s) with a`);
        log('nullable tenant_id — those rows are readable by EVERY tenant:');
        for (const r of leakyNull) log(`  - ${r.table_name}`);
        log('');
      }
    }

    // ── Verdict ───────────────────────────────────────────────────────────
    const failures: string[] = [];
    if (uuidScoped.length === 0) failures.push('No tenant-scoped tables found at all');
    if (noRls.length) failures.push(`${noRls.length} tenant-scoped table(s) have RLS disabled`);
    if (noPolicy.length) failures.push(`${noPolicy.length} tenant-scoped table(s) have no tenant_isolation policy`);
    if (leakyNull.length) failures.push(`${leakyNull.length} table(s) expose NULL-tenant rows to every tenant`);
    if (roleExempt) {
      failures.push(
        `role "${role.current_role}" is exempt from RLS ` +
          `(${role.is_superuser ? 'superuser' : 'BYPASSRLS'}) — policies are not enforced against it`
      );
    } else if (notForced.length) {
      failures.push(
        `${notForced.length} table(s) lack FORCE ROW LEVEL SECURITY; if "${role.current_role}" ` +
          'owns them, its queries bypass the policies'
      );
    }

    if (failures.length) {
      log('RESULT: gaps found');
      for (const f of failures) log(`  ! ${f}`);
      log('');
      process.exitCode = 1;
    } else {
      log('RESULT: tenant isolation is enforced for this role\n');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('verify-tenant-isolation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
