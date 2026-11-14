/**
 * #3280 (ask 1) — the read-only operator role `nucrm_ops`.
 *
 * The issue's story: `DATABASE_URL` is the application role, which is subject
 * to FORCE RLS, so an operator's own
 *
 *     psql "$DATABASE_URL" -At -c 'select count(*) from users'
 *
 * answers 0 on a database holding thousands of rows — without raising, and
 * without distinguishing "no rows exist" from "no rows visible". The ask was a
 * role that is not silently filtered.
 *
 * This file is the ratchet for that role's PROMISES, because a role's flags are
 * sticky and a grant is invisible until it is checked:
 *
 *   - it bypasses RLS (that is the point) but is NOT a superuser;
 *   - it can SELECT and nothing else, and every session it opens is read-only;
 *   - it is NOT a member of the application role, and the application role is
 *     NOT a member of it — BYPASSRLS is INHERITED, so a membership in either
 *     direction would hand the app a policy bypass, which is the exact failure
 *     #2253 exists to prevent;
 *   - the application role keeps its own least-privilege attributes.
 *
 * Mirrors the style of tests/unit/rls-least-privilege-role.test.ts (#2253):
 * text assertions over the provisioning SQL, because the provisioning step is
 * the operator's and there is no database in the unit suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const sql = readFileSync(join(ROOT, 'scripts/provision-ops-role.sql'), 'utf8');
const wrapper = readFileSync(join(ROOT, 'scripts/provision-ops-role.mjs'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const doc = readFileSync(join(ROOT, 'docs/database-security.md'), 'utf8');
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');

/** Every statement that names the role and grants or changes it. */
const roleStatements = sql
  .split('\n')
  .filter((l) => /(GRANT|REVOKE|CREATE ROLE|ALTER ROLE)/i.test(l))
  .filter((l) => /nucrm_ops/i.test(l));

/**
 * The SQL without its comments. The header explains WHY the forbidden grants
 * are forbidden, so a naive search of the whole file finds them in prose — the
 * rules below are about what the script EXECUTES.
 */
const code = sql
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

describe('provision-ops-role.sql (#3280 ask 1)', () => {
  it('creates the nucrm_ops role, and re-asserts its attributes every run', () => {
    expect(sql).toMatch(/CREATE ROLE nucrm_ops/i);
    expect(sql).toMatch(/ALTER ROLE nucrm_ops/i);
    // Idempotent: the create is behind an existence check, so a second run
    // alters rather than fails.
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'nucrm_ops'\)/);
  });

  it('is BYPASSRLS — the whole point is that an operator count is not filtered', () => {
    expect(sql).toMatch(/BYPASSRLS/i);
    // And it is asserted in the guard block, not only granted.
    expect(sql).toMatch(/rolbypassrls/i);
  });

  it('is never a superuser', () => {
    for (const line of roleStatements) {
      expect(line).not.toMatch(/(?<!NO)SUPERUSER/i);
    }
    expect(sql).toMatch(/nucrm_ops is a superuser/i);
  });

  it('grants SELECT and nothing else', () => {
    expect(sql).toMatch(/GRANT SELECT ON ALL TABLES IN SCHEMA public TO nucrm_ops/i);
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA public TO nucrm_ops/i);
    // No write privilege, and the write privileges are explicitly revoked in
    // case a previous run left them. Assert against the executed SQL only —
    // the header explains WHY the forbidden grants are forbidden, so a naive
    // search of the whole file finds them in prose.
    expect(code).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL PRIVILEGES)\b[^;]*TO nucrm_ops/i);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM nucrm_ops/i);
  });

  it('never grants the ops role to the app role, and the app role to the ops role', () => {
    // This membership would hand the app role a BYPASSRLS bypass; the script
    // asserts it is absent in the guard block and never creates it.
    expect(code).not.toMatch(/GRANT nucrm_ops TO nucrm_app/i);
    expect(code).not.toMatch(/GRANT nucrm_app TO nucrm_ops/i);
  });

  it('cannot create objects in the schema', () => {
    expect(sql).toMatch(/REVOKE CREATE ON SCHEMA public FROM nucrm_ops/i);
  });

  it('opens every session read-only, so "read-only" is a fact and not a name', () => {
    expect(sql).toMatch(/ALTER ROLE nucrm_ops SET default_transaction_read_only = on/i);
  });

  it('takes the password from a psql variable, never a committed literal', () => {
    expect(sql).toMatch(/ALTER ROLE nucrm_ops PASSWORD :'ops_password'/);
    expect(code).not.toMatch(/PASSWORD\s+'[^:'][^']*'/i);
  });

  it('runs with ON_ERROR_STOP so a partial provision cannot silently pass', () => {
    expect(sql).toMatch(/\\set ON_ERROR_STOP on/);
  });

  it('extends SELECT to tables the owner creates later', () => {
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO nucrm_ops/i);
  });

  it('refuses to run if the two roles are members of each other — BYPASSRLS is inherited', () => {
    // The one mistake that would be invisible everywhere else: a membership
    // hands the APPLICATION role a policy bypass. Assert against the executed
    // SQL only; the header names the failure in prose on purpose.
    expect(sql).toMatch(/pg_auth_members/i);
    expect(sql).toMatch(/nucrm_ops and nucrm_app are members of each other/i);
    expect(code).not.toMatch(/GRANT nucrm_ops TO nucrm_app/i);
    expect(code).not.toMatch(/GRANT nucrm_app TO nucrm_ops/i);
  });

  it('re-asserts the app role\'s own least-privilege attributes', () => {
    expect(sql).toMatch(/nucrm_app is superuser or BYPASSRLS/i);
    // The guard re-ASSERTS the app role's invariant; it never GRANTs the app
    // role anything in this script. Assert against the executed SQL only.
    expect(code).not.toMatch(/GRANT[^;]*TO nucrm_app/i);
  });

  it('never transfers table ownership to the ops role', () => {
    expect(code).not.toMatch(/OWNER TO nucrm_ops/i);
    expect(sql).toMatch(/nucrm_ops owns/i);
  });
});

describe('provision-ops-role.mjs (#3280 ask 1)', () => {
  it('takes the password from the environment and never prints it', () => {
    expect(wrapper).toMatch(/process\.env\.NUCRM_OPS_PASSWORD/);
    // The password may only reach psql as a variable, never a log line.
    expect(wrapper).not.toMatch(/console\.(log|error|warn)\([^)]*opsPassword/);
    expect(wrapper).not.toMatch(/console\.(log|error|warn)\([^)]*ops_password/);
    // …and every URL it prints is redacted.
    expect(wrapper).toMatch(/function redact/);
  });

  it('verifies the role against the database, not against the script it just ran', () => {
    expect(wrapper).toMatch(/rolbypassrls/i);
    expect(wrapper).toMatch(/rolsuper/i);
    expect(wrapper).toMatch(/default_transaction_read_only/i);
    expect(wrapper).toMatch(/pg_auth_members/i);
    // The write refusal is proved by asking Postgres to refuse it.
    expect(wrapper).toMatch(/FOR UPDATE/i);
  });

  it('arms the connection with the shared TLS policy (#3381)', () => {
    expect(wrapper).toMatch(/pgSslConfig/);
  });

  it('is reachable as an npm script', () => {
    expect(pkg.scripts['db:provision-ops-role']).toContain('provision-ops-role.mjs');
  });
});

describe('the operator role is documented (#3280 ask 1)', () => {
  it('docs/database-security.md says how to provision it and how to use it', () => {
    expect(doc).toMatch(/db:provision-ops-role/);
    expect(doc).toMatch(/nucrm_ops/);
    expect(doc).toMatch(/read-only/i);
  });

  it('docs/database-security.md says the app must never connect as it', () => {
    expect(doc).toMatch(/Never put it in the app's `DATABASE_URL`/);
  });

  it('.env.example documents the secret it needs', () => {
    expect(envExample).toMatch(/NUCRM_OPS_PASSWORD/);
  });
});
