/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3303 — SCIM provisioning gets a tenant context, and the guard stops believing
 * a verified token is the same thing as a verified RLS context.
 *
 * `GET /api/scim/v2/Users` answered `{"totalResults":0}` to an IdP that had just
 * provisioned users, and `PATCH`/`DELETE` matched zero rows, because the routes
 * ran every statement on the bare pool: `verifySCIMToken` proves the sender and
 * names the tenant, but it sets no `app.*` GUC, and `users` has no policy that a
 * machine token with no acting user can satisfy. The reads were only visible to
 * rule 2 of `scripts/check-rls-route-coverage.mjs` through the #3303 split-chain
 * fusion, and rule 1 stepped over the files because they do not spell their
 * authentication `requireAuth(` — so `scripts/rls-preauth-baseline.json` counted
 * 10 statements and nothing failed.
 *
 * This file is the completion of that issue's two halves:
 *   1. a mechanism whose token NAMES a tenant is now answerable to rule 1's
 *      wrapping question (a signature-only webhook still is not: it proves the
 *      sender, not the workspace);
 *   2. the SCIM routes run inside `withScimTenantContext`, and migration 0143
 *      adds the two narrow `users` arms keyed on `app.scim_tenant`.
 *
 * The writes are the part that a SELECT-only arm cannot carry: `users` UPDATE is
 * its own arm, and the two cross-tenant questions SCIM has to ask (does this user
 * work elsewhere? may I revoke their sessions?) are answered through the user's
 * own identity (`app.current_user`), the way 0127's `tenant_members_self_read`
 * was written to answer them — never by widening a tenant arm.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyse, readBaseline } from '../../scripts/check-rls-route-coverage.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'rls-preauth-baseline.json');
const MIGRATIONS = join(ROOT, 'drizzle', 'migrations');
const SCIM_LIST = 'app/api/scim/v2/Users/route.ts';
const SCIM_ITEM = 'app/api/scim/v2/Users/[id]/route.ts';
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** A one-route repository, so a guard rule can be watched deciding. */
function analyseFixture(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'scim-guard-'));
  const routeDir = join(dir, 'app', 'api', 'probe');
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(join(routeDir, 'route.ts'), body);
  try {
    return analyse({ root: dir, baseline: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('rule 1 sees a mechanism whose token names the tenant (#3303)', () => {
  it('flags a SCIM route that verifies a token and then reads on the bare pool', () => {
    const r = analyseFixture([
      "import { verifySCIMToken } from '@/lib/scim';",
      'export async function GET(request: Request) {',
      '  const who = await verifySCIMToken(token, fallback);',
      '  return db.select({ id: users.id }).from(users);',
      '}',
      '',
    ].join('\n'));
    expect(r.offenders).toContain('app/api/probe/route.ts');
  });

  it('still flags the route whose bearer gate moved into a shared helper (#3303, #1843)', () => {
    // The screen used to key on the innermost call, `verifySCIMToken(`. #3303 deleted the
    // private copy each SCIM route carried — item route had outgrown the 500-line ceiling —
    // and a rule that only recognises the inner name would have stopped seeing those two
    // routes the day the duplication went away: a fix that silently de-scopes the guard is
    // worse than no fix, because the green run now proves nothing. `authenticateSCIMRequest`
    // returns `{ tenantId }`, so it names the workspace exactly as the token check did.
    const r = analyseFixture([
      "import { authenticateSCIMRequest } from '@/lib/scim/user-route-support';",
      'export async function GET(request: Request) {',
      '  const who = await authenticateSCIMRequest(request);',
      '  return db.select({ id: users.id }).from(users);',
      '}',
      '',
    ].join('\n'));
    expect(r.offenders).toContain('app/api/probe/route.ts');
  });

  it('does not accept an import as proof that a context is opened', () => {
    const r = analyseFixture([
      "import { verifySCIMToken } from '@/lib/scim';",
      "import { withScimTenantContext } from '@/lib/db/scim-context';",
      'export async function GET(request: Request) {',
      '  const who = await verifySCIMToken(token, fallback);',
      '  return db.select({ id: users.id }).from(users);',
      '}',
      '',
    ].join('\n'));
    expect(r.offenders).toContain('app/api/probe/route.ts');
  });

  it('accepts the wrapped form — a call, not a mention', () => {
    const r = analyseFixture([
      "import { verifySCIMToken } from '@/lib/scim';",
      "import { withScimTenantContext } from '@/lib/db/scim-context';",
      'export async function GET(request: Request) {',
      '  const who = await verifySCIMToken(token, fallback);',
      '  return withScimTenantContext(who.tenantId, (tx) => tx.select({ id: users.id }).from(users));',
      '}',
      '',
    ].join('\n'));
    expect(r.offenders).toEqual([]);
    expect(r.skippedAuthenticators).toEqual([]);
  });

  it('still steps over a signature-only webhook, which proves the sender and not the tenant', () => {
    const r = analyseFixture([
      "import { verifyWebhookSignature } from '@/lib/stripe';",
      'export async function POST(request: Request) {',
      '  const event = await verifyWebhookSignature(body, sig);',
      '  return db.insert(webhookEvents).values({ id: event.id });',
      '}',
      '',
    ].join('\n'));
    expect(r.offenders).toEqual([]);
    expect(r.skippedAuthenticators.map((s) => s.file)).toContain('app/api/probe/route.ts');
  });

  it('accepts the inbound API-key shape, which already pins a client for the request', () => {
    const r = analyseFixture([
      "import { resolveApiKey } from '@/lib/webhooks/inbound-auth';",
      "import { withTenantScope } from '@/lib/api/with-api-route';",
      'export async function POST(request: Request) {',
      '  const key = await resolveApiKey(raw);',
      '  return withTenantScope(() => db.insert(contacts).values({}));',
      '}',
      '',
    ].join('\n'));
    expect(r.offenders).toEqual([]);
  });
});

describe('the real tree: SCIM is contextualised and nothing is left on its allowance', () => {
  const baseline = readBaseline(BASELINE_PATH);
  const raw = analyse({ root: ROOT, baseline: {} });
  const current = analyse({ root: ROOT, baseline });

  it('reports no bare-pool identity read in either SCIM route', () => {
    expect(raw.hits).toEqual([]);
  });

  it('retires the two SCIM allowances instead of leaving a number that excuses nothing', () => {
    expect(Object.keys(baseline).filter((k) => k.includes('scim'))).toEqual([]);
    expect(current.allowed).toBe(0);
    expect(current.findings).toEqual([]);
  });

  it('no longer names SCIM among the routes rule 1 cannot judge', () => {
    const files = current.skippedAuthenticators.map((s) => s.file);
    expect(files).not.toContain(SCIM_LIST);
    expect(files).not.toContain(SCIM_ITEM);
  });

  for (const file of [SCIM_LIST, SCIM_ITEM]) {
    it(`${file} reaches the pool through the context helper only`, () => {
      const src = read(file);
      expect(src).toContain('withScimTenantContext(');
      expect(src).not.toMatch(/\bdb\.(select|insert|update|delete|query|execute|transaction)\b/);
      // The token is checked before any context is opened for the tenant it names.
      expect(src.indexOf('authenticateSCIMRequest(')).toBeLessThan(src.indexOf('withScimTenantContext('));
      expect(src).toContain('authenticateSCIMRequest(');
    });
  }

  it('asks the cross-tenant email question only inside the shipped lookup window', () => {
    expect(read(SCIM_LIST)).toContain('withScimEmailLookup(');
    expect(read(SCIM_ITEM)).toContain('withScimEmailLookup(');
  });
});

describe('migration 0143 grants the two users arms and nothing wider (#3303)', () => {
  const up = readdirSync(MIGRATIONS).find((f) => /^0143_.*\.sql$/.test(f) && !f.endsWith('.down.sql'));
  const sql = up ? readFileSync(join(MIGRATIONS, up), 'utf8') : '';

  it('exists with a rollback file', () => {
    expect(up, 'a 0143 up-migration').toBeDefined();
    expect(readdirSync(MIGRATIONS)).toContain(up!.replace(/\.sql$/, '.down.sql'));
  });

  it('adds a SELECT arm and an UPDATE arm on users, both keyed on app.scim_tenant', () => {
    expect(sql).toMatch(/CREATE POLICY "users_tenant_scim_read" ON "users"[\s\S]*?FOR SELECT[\s\S]*?app\.scim_tenant/);
    expect(sql).toMatch(/CREATE POLICY "users_tenant_scim_update" ON "users"[\s\S]*?FOR UPDATE[\s\S]*?app\.scim_tenant/);
  });

  it('names the tenant only through the dedicated GUC, never through app.current_tenant', () => {
    // The header explains *why* app.current_tenant would be the wrong key; only
    // the executable SQL is the policy, so the check reads past the comment lines.
    const executable = sql.replace(/^\s*--.*$/gm, '');
    expect(executable).not.toContain('app.current_tenant');
  });

  it('grants nothing on sessions or tenant_members — those are answered by the user identity', () => {
    expect(sql).not.toMatch(/ON "(?:sessions|tenant_members|refresh_tokens)"/);
  });

  it('is in the journal, unapplied like every migration since #2537', () => {
    const journal = JSON.parse(read('drizzle/migrations/meta/_journal.json')) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    // Looked up by tag, not taken from the tail: the chain keeps growing — #3406
    // appended 0144 and #3410 appended 0145 after this migration — and the test's
    // subject is 0143 itself. Being LAST was incidental to #3303, so pinning by
    // rank would make every later append edit this assertion.
    const mine = journal.entries.filter((e) => e.tag === up!.replace(/\.sql$/, ''));
    expect(mine, '0143 is missing from the journal').toHaveLength(1);
    expect(mine[0]!.idx).toBe(145);
    expect(mine[0]!.when).toBe(1793440000000);
    expect(journal.entries.filter((e) => e.idx === mine[0]!.idx)).toHaveLength(1);
    const last = journal.entries[journal.entries.length - 1];
    expect(last.idx).toBeGreaterThan(145);
  });
});

describe('app.scim_tenant is cleared on both connection-reset lists (#2446)', () => {
  const resetLine = (file: string) => {
    const src = read(file);
    const line = src.split('\n').find((l) => l.includes("SELECT set_config('app.current_tenant'"));
    if (!line) throw new Error(`${file} no longer carries a checkout reset`);
    return [...line.matchAll(/set_config\('([^']+)', '([^']*)'/g)].map((m) => m[1] ?? '');
  };

  it('both lists carry it, and they still carry the same set', () => {
    const pool = resetLine('lib/db/pool.ts');
    const pinned = resetLine('lib/db/request-connection.ts');
    expect(pool).toEqual(pinned);
    expect(pool).toContain('app.scim_tenant');
  });

  it('is the twentieth name, not a silent replacement of one', () => {
    expect(resetLine('lib/db/pool.ts')).toHaveLength(20);
    expect(resetLine('lib/db/request-connection.ts')).toHaveLength(20);
  });
});

describe('the helper opens the context the routes then use', () => {
  const helper = () => read('lib/db/scim-context.ts');

  it('sets app.scim_tenant inside the tenant transaction', () => {
    const src = helper();
    expect(src).toMatch(/export\s+(?:async\s+)?function\s+withScimTenantContext/);
    expect(src).toContain("set_config('app.scim_tenant'");
    expect(src).toContain('NO_USER_SENTINEL');
    expect(src).toContain('withTenantContext(');
  });

  it('scopes the user identity and the email lookup, and closes both again', () => {
    const src = helper();
    expect(src).toMatch(/export\s+(?:async\s+)?function\s+withScimUserIdentity/);
    expect(src).toMatch(/export\s+(?:async\s+)?function\s+withScimEmailLookup/);
    expect(src).toContain("set_config('app.auth_lookup'");
    expect(src).toContain('finally');
  });
});
