/**
 * #2253 — least-privilege role provisioning + RLS-bypass guard.
 *
 * Covers the two pure (no-database) parts of the fix:
 *   1. scripts/provision-app-role.sql — text assertions (mirrors the style of
 *      schema-migration-coverage.test.ts): the SQL must create a NON-superuser,
 *      NON-BYPASSRLS role, grant DML + schema USAGE only, never ownership/CREATE,
 *      set ALTER DEFAULT PRIVILEGES, and take the password from a psql variable
 *      (never a committed literal).
 *   2. lib/db/least-privilege.ts — the verdict logic that both the CI guard and
 *      the provisioning verifier rely on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateRolePrivileges,
  ROLE_PRIVILEGE_SQL,
  type RolePrivilegeFacts,
} from '@/lib/db/least-privilege';

const sqlPath = join(import.meta.dirname!, '../../scripts/provision-app-role.sql');
const sql = readFileSync(sqlPath, 'utf8');

describe('provision-app-role.sql (Issue #2253)', () => {
  it('creates the nucrm_app role', () => {
    expect(sql).toMatch(/CREATE ROLE nucrm_app/i);
    expect(sql).toMatch(/ALTER ROLE nucrm_app/i);
  });

  it('grants least-privilege attributes (no superuser / no bypassrls / no createdb / no createrole)', () => {
    for (const attr of ['NOSUPERUSER', 'NOBYPASSRLS', 'NOCREATEDB', 'NOCREATEROLE']) {
      expect(sql).toContain(attr);
    }
  });

  it('never grants SUPERUSER / BYPASSRLS / CREATEDB / CREATEROLE to nucrm_app', () => {
    // Every occurrence of these must be negated (NO...); catch accidental grants.
    const grantLines = sql
      .split('\n')
      .filter((l) => /(GRANT|CREATE ROLE|ALTER ROLE)/i.test(l))
      .filter((l) => /nucrm_app/i.test(l));
    for (const line of grantLines) {
      expect(line).not.toMatch(/(?<!NO)SUPERUSER/i);
      expect(line).not.toMatch(/(?<!NO)BYPASSRLS/i);
      expect(line).not.toMatch(/(?<!NO)CREATEDB/i);
      expect(line).not.toMatch(/(?<!NO)CREATEROLE/i);
    }
  });

  it('grants DML only on tables (SELECT/INSERT/UPDATE/DELETE)', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nucrm_app/i);
  });

  it('grants USAGE on sequences (needed for identity/serial columns)', () => {
    expect(sql).toMatch(/GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO nucrm_app/i);
  });

  it('grants schema USAGE but revokes CREATE (no DDL for the app role)', () => {
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA public TO nucrm_app/i);
    expect(sql).toMatch(/REVOKE CREATE ON SCHEMA public FROM nucrm_app/i);
  });

  it('sets ALTER DEFAULT PRIVILEGES so future migrated tables stay reachable', () => {
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nucrm_app/i);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE ON SEQUENCES TO nucrm_app/i);
  });

  it('does not transfer table ownership to nucrm_app', () => {
    expect(sql).not.toMatch(/OWNER TO nucrm_app/i);
    // and explicitly guards that nucrm_app owns nothing.
    expect(sql).toMatch(/nucrm_app owns/i);
  });

  it('takes the password from a psql variable, never a committed literal', () => {
    expect(sql).toMatch(/ALTER ROLE nucrm_app PASSWORD :'app_password'/);
    // No hardcoded password assignment like PASSWORD 'something'.
    expect(sql).not.toMatch(/PASSWORD\s+'[^:'][^']*'/i);
  });

  it('is idempotent: role creation is guarded by an existence check', () => {
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'nucrm_app'\)/);
  });

  it('runs with ON_ERROR_STOP so a partial provision cannot silently pass', () => {
    expect(sql).toMatch(/\\set ON_ERROR_STOP on/);
  });
});

describe('evaluateRolePrivileges (Issue #2253)', () => {
  const base: RolePrivilegeFacts = {
    rolname: 'nucrm_app',
    rolsuper: false,
    rolbypassrls: false,
  };

  it('fails for a superuser even with no other red flags', () => {
    const v = evaluateRolePrivileges({ ...base, rolsuper: true });
    expect(v.ok).toBe(false);
    expect(v.failures.map((f) => f.code)).toContain('superuser');
  });

  it('fails for a BYPASSRLS role', () => {
    const v = evaluateRolePrivileges({ ...base, rolbypassrls: true });
    expect(v.ok).toBe(false);
    expect(v.failures.map((f) => f.code)).toContain('bypassrls');
  });

  it('fails when the role owns tenant tables that are not FORCE RLS', () => {
    const v = evaluateRolePrivileges({ ...base, ownsTenantTables: 3, hasUnforcedTables: true });
    expect(v.ok).toBe(false);
    expect(v.failures.map((f) => f.code)).toContain('owner-without-force');
  });

  it('passes when the role owns tables but every one is FORCE RLS', () => {
    const v = evaluateRolePrivileges({ ...base, ownsTenantTables: 3, hasUnforcedTables: false });
    expect(v.ok).toBe(true);
  });

  it('passes for a clean non-owner non-superuser role', () => {
    const v = evaluateRolePrivileges({ ...base, ownsTenantTables: 0, hasUnforcedTables: false });
    expect(v.ok).toBe(true);
    expect(v.findings.some((f) => f.code === 'enforced')).toBe(true);
  });

  it('ignores ownership when it was not probed (null)', () => {
    const v = evaluateRolePrivileges({ ...base, ownsTenantTables: null });
    expect(v.ok).toBe(true);
  });

  it('reports multiple failures at once', () => {
    const v = evaluateRolePrivileges({
      rolname: 'postgres',
      rolsuper: true,
      rolbypassrls: true,
      ownsTenantTables: 10,
      hasUnforcedTables: true,
    });
    expect(v.ok).toBe(false);
    expect(v.failures.length).toBe(3);
  });
});

describe('ROLE_PRIVILEGE_SQL (Issue #2253)', () => {
  it('reads rolsuper and rolbypassrls for the connecting role', () => {
    expect(ROLE_PRIVILEGE_SQL).toMatch(/rolsuper/);
    expect(ROLE_PRIVILEGE_SQL).toMatch(/rolbypassrls/);
    expect(ROLE_PRIVILEGE_SQL).toMatch(/current_user/);
  });
});
