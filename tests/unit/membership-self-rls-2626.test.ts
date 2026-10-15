/**
 * #2626 — workspace resolution dies without the membership self-read.
 *
 * requireAuth redeems a session inside withUserContext(userId), which sets
 * ONLY app.current_user (lib/db/rls.ts). The membership join then reads
 * tenant_members + roles, whose sole policy (`tenant_isolation`) compares
 * tenant_id to app.current_tenant — the value the read exists to discover.
 * Fail-closed deparse returns zero rows, and every non-super-admin gets
 * 403 "No active workspace" on a fresh database.
 *
 * This pins the static shape of migration 0127, the fix: two SELECT-only
 * policies keyed on app.current_user, drop-then-create so a host carrying
 * the hand-applied hotpatch converges instead of aborting, and NOT keyed
 * on app.is_super_admin (#2253's fleet-wide flip) or app.current_tenant
 * (the chicken-and-egg this migration exists to break).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname!, '..', '..', 'drizzle', 'migrations', '0127_membership_self_scoped_select.sql');
const DOWN = MIG.replace(/\.sql$/, '.down.sql');

const up = readFileSync(MIG, 'utf8');
const down = readFileSync(DOWN, 'utf8');

describe('0127 membership self-scoped SELECT (#2626)', () => {
  it('creates tenant_members_self_read keyed on app.current_user, SELECT only', () => {
    expect(up).toMatch(/DROP POLICY IF EXISTS "tenant_members_self_read" ON "tenant_members";/);
    expect(up).toMatch(/CREATE POLICY "tenant_members_self_read" ON "tenant_members"\s*AS PERMISSIVE\s*FOR SELECT/);
    expect(up).toContain("status = 'active'");
    expect(up).toContain("NULLIF(current_setting('app.current_user', true), '')");
  });

  it('creates roles_tenant_member_read via a stable tenant_members EXISTS (no self-recursion)', () => {
    expect(up).toMatch(/DROP POLICY IF EXISTS "roles_tenant_member_read" ON "roles";/);
    expect(up).toMatch(/CREATE POLICY "roles_tenant_member_read" ON "roles"\s*AS PERMISSIVE\s*FOR SELECT/);
    // The EXISTS must name tenant_members, never roles, as the subquery —
    // a policy on roles that reads roles re-triggers the recursion class.
    const body = up.slice(up.indexOf('"roles_tenant_member_read" ON "roles"'));
    const exists = body.slice(body.indexOf('EXISTS'), body.indexOf('END $$'));
    expect(exists).toContain('FROM tenant_members tm');
    expect(exists).not.toMatch(/FROM roles/);
  });

  it('grants neither app.is_super_admin nor app.current_tenant in either USING clause', () => {
    const sqlOnly = up.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(sqlOnly).not.toContain('app.is_super_admin');
    // tenant_isolation (pre-existing, tenant-keyed) is untouched; the NEW
    // policies must not widen it with a current_tenant arm.
    const policyBodies = sqlOnly.slice(sqlOnly.indexOf('DO $$'));
    const arms = policyBodies.match(/current_setting\('[^']+'/g) ?? [];
    expect(arms.every((a) => a.includes('app.current_user'))).toBe(true);
  });

  it('wraps both policies in one drop-then-create DO block (hotpatch-convergent)', () => {
    expect(up.match(/DO \$\$/g)).toHaveLength(1);
    expect(up.match(/DROP POLICY IF EXISTS/g)).toHaveLength(2);
    expect(up.match(/CREATE POLICY/g)).toHaveLength(2);
  });

  it('down drops exactly the two policies and touches no rows', () => {
    expect(down).toContain('DROP POLICY IF EXISTS "tenant_members_self_read" ON "tenant_members";');
    expect(down).toContain('DROP POLICY IF EXISTS "roles_tenant_member_read" ON "roles";');
    expect(down).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it('journal entry idx 127 exists, monotone in `when`, tag matches the file', () => {
    const journal = JSON.parse(
      readFileSync(join(import.meta.dirname!, '..', '..', 'drizzle', 'migrations', 'meta', '_journal.json'), 'utf8'),
    );
    const last = journal.entries[journal.entries.length - 1];
    expect(last.idx).toBe(127);
    expect(last.tag).toBe('0127_membership_self_scoped_select');
    expect(last.when).toBeGreaterThan(journal.entries[journal.entries.length - 2].when);
  });
});
