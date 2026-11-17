/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3577 — audit-verify must not report a valid chain while verifying nothing.
 *
 * The superadmin's RLS context cannot see audit_logs rows (the only policy is
 * tenant_isolation), so the distinct-tenant query returned [] and `every()` on
 * [] is true. A broken chain in any tenant was reported `chain_valid: true,
 * tenants_checked: 0` with HTTP 200. Migration 0147 grants a SELECT-only
 * superadmin policy; this test pins the fail-closed verdict and the migration.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { auditChainVerdict } from '../../app/api/system/audit-verify/route';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');
const ROUTE = read('app/api/system/audit-verify/route.ts');
const UP = read('drizzle/migrations/0147_audit_logs_superadmin_read.sql');
const DOWN = read('drizzle/migrations/0147_audit_logs_superadmin_read.down.sql');
const JOURNAL = JSON.parse(read('drizzle/migrations/meta/_journal.json'));

describe('#3577 the audit-chain verdict fails closed', () => {
  it('zero verified tenants is NOT a valid chain', () => {
    expect(auditChainVerdict([])).toBe(false);
  });

  it('all verified tenants valid is a valid chain', () => {
    expect(auditChainVerdict([{ chain_valid: true }, { chain_valid: true }])).toBe(true);
  });

  it('one broken tenant invalidates the verdict', () => {
    expect(auditChainVerdict([{ chain_valid: true }, { chain_valid: false }])).toBe(false);
  });

  it('the route uses the fail-closed verdict and a non-200 status when it fails', () => {
    expect(ROUTE).toContain('const chainValid = auditChainVerdict(tenants);');
    expect(ROUTE).toContain('{ status: chainValid ? 200 : 503 }');
  });

  it('global audit rows with no tenant are excluded', () => {
    expect(ROUTE).toMatch(/\.filter\(\(id\): id is string => typeof id === 'string' && id\.length > 0\)/);
  });
});

describe('#3577 migration 0147 grants superadmin SELECT on audit_logs', () => {
  it('uses the established superadmin GUC pattern, SELECT only', () => {
    expect(UP).toMatch(/CREATE POLICY "audit_logs_super_admin_read" ON "audit_logs" FOR SELECT/);
    expect(UP).toMatch(/current_setting\('app\.is_super_admin'::text, true\)/);
  });

  it('is idempotent, self-verifying, and has a down migration', () => {
    expect(UP).toContain('DROP POLICY IF EXISTS "audit_logs_super_admin_read"');
    expect(UP).toMatch(/RAISE EXCEPTION '0147:/);
    expect(DOWN).toContain('DROP POLICY IF EXISTS "audit_logs_super_admin_read" ON "audit_logs";');
  });

  it('is registered in the migration journal', () => {
    expect(JOURNAL.entries.some((e: { tag: string }) => e.tag === '0147_audit_logs_superadmin_read')).toBe(true);
  });
});
