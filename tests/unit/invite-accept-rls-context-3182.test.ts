/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeSource,
  CONTEXT_HELPERS,
  DEFAULT_TARGETS,
  loadTenantTables,
  maskComments,
  run,
} from '../../scripts/check-portal-rls-context.mts';

/**
 * #3182 — accepting a team invitation was dead on the shipped schema.
 *
 * `invitations` carries `tenant_isolation` and nothing else, and the invitation is
 * the row that NAMES the tenant, so the route could not establish a context before
 * reading it: the contextless pool read answered 0 rows and every genuine link got
 * a 404. Measured on the local force-RLS dev database as `nucrm_app` (one
 * transaction, ROLLBACKed): the same read answers 0 rows with no GUC and 1 row
 * under `app.current_tenant`; `INSERT INTO tenant_members` raises 42501; the
 * `accepted_at` UPDATE affects 0 rows without error.
 *
 * Every case below is either a property of the grant (SELECT-only, credential-key,
 * fail-closed when the GUC is absent), a property of the routes (no bare-pool read
 * of a policyed table left in either file), or a property of the GUARD — which is
 * the thing that let this ship: #2446's guard never walked `app/api/auth/*`, so the
 * shape was invisible rather than tolerated. The planted snippet at the end pins
 * that the widened guard still has teeth, because "OK — 19 file(s)" over a scope
 * that excludes the broken file proves nothing.
 *
 * Deliberately static: nothing here needs a database. The behavioural half of
 * #3182 is the integration job, which applies 0133 and runs the real statements.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const UP = 'drizzle/migrations/0133_invitations_credential_lookup.sql';
const DOWN = 'drizzle/migrations/0133_invitations_credential_lookup.down.sql';
const ACCEPT = 'app/api/auth/accept-invite/route.ts';
const DETAILS = 'app/api/auth/invite-details/route.ts';

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** The route's code with its comments masked, so a comment that *names* the pool
 *  is not mistaken for a call on it — the same masking the guard itself uses. */
const code = (rel: string) => maskComments(read(rel));

describe('0133: the grant is a credential read and nothing else', () => {
  it('ships an up-migration and a matching down-migration', () => {
    expect(existsSync(join(ROOT, UP))).toBe(true);
    expect(existsSync(join(ROOT, DOWN))).toBe(true);
  });

  it('creates exactly one policy, on invitations', () => {
    const sql = read(UP);
    const created = [...sql.matchAll(/CREATE POLICY "([^"]+)" ON "([^"]+)"/g)];
    expect(created).toHaveLength(1);
    expect(created[0][1]).toBe('invitations_credential_lookup');
    expect(created[0][2]).toBe('invitations');
  });

  it('is SELECT-only — no write on this table gains a new path', () => {
    const sql = read(UP);
    expect(sql).toMatch(/FOR\s+SELECT/);
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/);
  });

  it('keys off the credential GUC and NULLIFs it, so an empty GUC matches nothing', () => {
    const sql = read(UP);
    expect(sql).toContain("current_setting('app.portal_lookup_token', true)");
    expect(sql).toMatch(/NULLIF\(\s*current_setting\('app\.portal_lookup_token',\s*true\)\s*,\s*''\s*\)/);
  });

  it('names neither the tenant nor the super-admin GUC (#2253)', () => {
    const sql = read(UP);
    const code = sql.replace(/--[^\n]*/g, '');
    expect(code).not.toContain('app.current_tenant');
    expect(code).not.toContain('app.is_super_admin');
    expect(code).not.toContain('app.current_user');
  });

  it('is drop-then-create, so a hand-apply and a db:migrate replay are the same no-op', () => {
    const sql = read(UP);
    expect(sql).toContain('DROP POLICY IF EXISTS "invitations_credential_lookup" ON "invitations"');
  });

  it('the rollback drops only this policy and leaves 0122/0123 arms alone', () => {
    const down = read(DOWN);
    expect(down).toMatch(/DROP POLICY IF EXISTS "invitations_credential_lookup" ON "invitations"/);
    expect(down).not.toMatch(/DROP POLICY.*(portal_clients|support_tickets|quotes|csat_surveys|signing_requests|platform_settings)"/);
  });

  it('is journalled last, with idx equal to its position, and no duplicate idx', () => {
    const journal = JSON.parse(read('drizzle/migrations/meta/_journal.json')) as {
      entries: { idx: number; tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === '0133_invitations_credential_lookup');
    expect(at).toBe(journal.entries.length - 1);
    const prev = journal.entries[at - 1];
    expect(journal.entries[at].idx).toBe(at);
    expect(journal.entries[at].idx).toBeGreaterThan(prev.idx);
    const idxs = journal.entries.map((e) => e.idx);
    expect(new Set(idxs).size).toBe(idxs.length);
    for (const e of journal.entries) {
      expect(existsSync(join(ROOT, `drizzle/migrations/${e.tag}.sql`))).toBe(true);
    }
  });
});

describe('the acceptance routes stop reading policyed tables on the pool', () => {
  it('accept-invite resolves the invitation through withPortalLookupContext', () => {
    const src = read(ACCEPT);
    const body = code(ACCEPT);
    expect(src).toMatch(/withPortalLookupContext\(\s*\{\s*accessToken:\s*inviteToken\s*\}/);
    expect(body).not.toMatch(/\bdb\s*\.\s*select\s*\(/);
    expect(body).not.toMatch(/from\s*['"]@\/drizzle\/db['"]/);
  });

  it('accept-invite runs the whole write block in the tenant context the row supplies', () => {
    const body = code(ACCEPT);
    expect(body).toMatch(/withTenantContext\(\s*inv\.tenantId,\s*userId\s*,/);
    expect(body).not.toMatch(/\bdb\s*\.\s*transaction\s*\(/);
  });

  it('accept-invite reads no users row off the pool — it uses the verified session (#3182)', () => {
    const body = code(ACCEPT);
    expect(body).not.toMatch(/db\.query\.users\.findFirst/);
    expect(body).toMatch(/session\.email/);
  });

  it('invite-details resolves the same credential and drops its contextless users read', () => {
    const src = read(DETAILS);
    const body = code(DETAILS);
    expect(src).toMatch(/withPortalLookupContext\(\s*\{\s*accessToken:\s*token\s*\}/);
    expect(body).not.toMatch(/db\.query\.users\.findFirst/);
    expect(body).not.toMatch(/from\s*['"]@\/drizzle\/db['"]/);
    expect(body).toMatch(/p\?\.email/);
  });
});

describe('the #2446 guard can actually see these routes now', () => {
  it('both routes are in the guard scope, not just in the docs', () => {
    expect(DEFAULT_TARGETS).toContain(ACCEPT);
    expect(DEFAULT_TARGETS).toContain(DETAILS);
  });

  it('withPortalLookupContext is a recognised context-establishing helper', () => {
    expect(CONTEXT_HELPERS).toContain('withPortalLookupContext');
  });

  it('the shipped guard run over its own DEFAULT_TARGETS is clean', async () => {
    const { violations, files, reads } = await run(DEFAULT_TARGETS, ROOT);
    expect(reads).toBeGreaterThan(0);
    expect(files).toBeGreaterThanOrEqual(DEFAULT_TARGETS.length);
    expect(violations).toEqual([]);
  }, 120_000);

  it('and still names the shape #3182 removed, so "clean" means clean', async () => {
    const tables = await loadTenantTables(ROOT);
    const planted = [
      `import { db } from '@/drizzle/db';`,
      `import { invitations, tenantMembers } from '@/drizzle/schema';`,
      `export async function POST() {`,
      `  const inv = await db.select({ id: invitations.id }).from(invitations).limit(1);`,
      `  await db.transaction(async (tx) => {`,
      `    await tx.insert(tenantMembers).values({ tenantId: inv.tenantId });`,
      `  });`,
      `}`,
    ].join('\n');
    const { violations } = analyzeSource('planted/invite-shape.ts', planted, tables, [], ROOT);
    const named = violations.map((v) => `${v.file}:${v.table}`);
    expect(named).toContain('planted/invite-shape.ts:invitations');
    expect(named).toContain('planted/invite-shape.ts:tenantMembers');
  }, 120_000);
});

describe('reusing app.portal_lookup_token means no new GUC can leak', () => {
  it('both pooled-reset lists already reset the GUC this grant uses', () => {
    for (const rel of ['lib/db/pool.ts', 'lib/db/request-connection.ts']) {
      expect(read(rel)).toContain("set_config('app.portal_lookup_token', '', false)");
    }
  });

  it('the migration introduces no GUC name the reset lists do not already carry', () => {
    const gucs = new Set(
      [...read(UP).matchAll(/current_setting\('([^']+)'/g)].map((m) => m[1]),
    );
    const reset = read('lib/db/pool.ts');
    for (const guc of gucs) expect(reset).toContain(`set_config('${guc}', '', false)`);
  });
});
