/**
 * #3288 ask 3 — the RLS route guard could not see the routes that needed it most.
 *
 * `scripts/check-rls-route-coverage.mjs` (#1838) flags a route that *authenticates*
 * (`requireAuth(` / `requireTenantCtx(`) and queries `db` without a wrapper. That is the
 * cross-tenant-leak shape, and it is a good rule. But the four issues found by hand in one
 * afternoon — #3288, #3289, #3290, #3304 — are the opposite shape: a route that never
 * authenticates, because it is the thing that establishes the identity. Those files have no
 * `requireAuth(` call, so the guard skipped them, and being skipped is what let
 * `db.query.users.findFirst` sit in the password-reset route for months returning zero rows.
 *
 * The missing rule is the pre-auth surface: a route that reads or writes a
 * *credential/identity* table (`users`, `sessions`, `password_resets`, `oauth_clients`,
 * `oauth_codes`, `oauth_tokens`, `email_verifications`) through the bare pool. Not a
 * tenant-scoped business table — those get filtered to zero rows and the handler notices.
 * These are the tables whose SELECT policies key on a GUC that does not exist yet on an
 * anonymous request (`app.current_user`, `app.is_super_admin`), so an unprivileged read is
 * always empty, and a route that answers "ok" when it finds nothing is indistinguishable
 * from one that answered correctly.
 *
 * Statement-level, not file-level, and that distinction is the whole screen: #3288's own file
 * already contained `withTokenIssueContext` for the INSERT two lines below the broken SELECT.
 * A rule that asked "does this file use a context helper anywhere?" had been satisfiable by
 * that route and would have found nothing. The receiver is what matters — `db.`/`database.`/
 * `pool.` is the pool with every `app.*` GUC cleared (`lib/db/pool.ts`), `tx.` is a
 * transaction somebody opened a privilege inside of.
 *
 * Tests run against fixtures in a temp directory, plus the real tree: the ratchet must be
 * shrink-only, so an allowance whose site vanished is a finding, and an allowance nobody
 * justified is a finding too.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname!, '../..');
const GUARD = join(ROOT, 'scripts/check-rls-route-coverage.mjs');

let dir = '';
let n = 0;
const made: string[] = [];

/** Build a throwaway app/api tree so the screen can be pointed at a known surface. */
function fixture(routes: Record<string, string>, baseline?: Record<string, unknown>): string {
  const d = join(tmpdir(), `rls-preauth-${process.pid}-${n++}`);
  made.push(d);
  for (const [rel, body] of Object.entries(routes)) {
    const p = join(d, 'app', 'api', rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  }
  mkdirSync(join(d, 'scripts'), { recursive: true });
  writeFileSync(join(d, 'package.json'), `${JSON.stringify({ name: 'fixture', scripts: {} }, null, 2)}\n`);
  if (baseline !== undefined) {
    writeFileSync(join(d, 'scripts', 'rls-preauth-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  }
  return d;
}

const run = (d: string, extra: string[] = []) => {
  const r = spawnSync('node', [GUARD, '--root', d, ...extra], { encoding: 'utf8' });
  return { out: `${r.stdout}${r.stderr}`, code: r.status };
};

const BARE_USERS: string = [
  "import { db } from '@/drizzle/db';",
  "import { users } from '@/drizzle/schema';",
  'export async function POST(request) {',
  '  const user = await db.query.users.findFirst({ where: eq(users.email, email) });',
  '  return Response.json({ ok: true });',
  '}',
].join('\n');

const WRAPPED_USERS = [
  "import { users } from '@/drizzle/schema';",
  "import { withAuthLookupContext } from '@/lib/db/rls';",
  'export async function POST(request) {',
  '  const [user] = await withAuthLookupContext(async (tx) =>',
  '    await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)',
  '  );',
  '  return Response.json({ ok: true });',
  '}',
].join('\n');

beforeAll(() => {
  dir = fixture({ 'probe/route.ts': BARE_USERS });
});

afterAll(() => {
  for (const d of made) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* tmp cleanup is best-effort */ }
  }
});

describe('the pre-auth rule sees a bare-pool identity read', () => {
  it('flags db.query.users.findFirst in a route that never authenticates', () => {
    const { out, code } = run(fixture({ 'auth/x/route.ts': BARE_USERS }));
    expect(code).toBe(1);
    expect(out).toMatch(/PREAUTH_UNCONTEXTED_READ\tapp\/api\/auth\/x\/route\.ts:4/);
  });

  it('accepts the same read through a transaction a context helper opened', () => {
    const { out, code } = run(fixture({ 'auth/y/route.ts': WRAPPED_USERS }));
    expect(out).not.toMatch(/PREAUTH_UNCONTEXTED_READ/);
    expect(code, 'the wrapped route is the fixed shape and must exit 0').toBe(0);
  });

  it('names every credential table, because each one is a policy keyed on a missing GUC', () => {
    for (const table of ['users', 'sessions', 'passwordResets', 'oauthClients', 'oauthCodes', 'oauthTokens', 'emailVerifications']) {
      const src = [
        "import { db } from '@/drizzle/db';",
        'export async function GET() {',
        `  return await db.select().from(${table}).limit(1);`,
        '}',
      ].join('\n');
      const { out } = run(fixture({ 'auth/t/route.ts': src }));
      expect(out, `${table} must be on the pre-auth list`).toMatch(/PREAUTH_UNCONTEXTED_READ/);
    }
  });

  it('reads a raw statement the same way as a Drizzle chain', () => {
    const src = [
      'export async function GET() {',
      "  return await db.execute(sql`select id from password_resets where token = $1`);",
      '}',
    ].join('\n');
    expect(run(fixture({ 'auth/raw/route.ts': src })).out).toMatch(/PREAUTH_UNCONTEXTED_READ/);
  });

  it('leaves business tables alone — that is #1838\'s rule, not this one', () => {
    const src = [
      "import { db } from '@/drizzle/db';",
      'export async function GET() {',
      '  return await db.select().from(leads).limit(1);',
      '}',
    ].join('\n');
    expect(run(fixture({ 'public/z/route.ts': src })).out).not.toMatch(/PREAUTH_UNCONTEXTED_READ/);
  });

  it('does not read prose: a comment about the pool is not a query on it', () => {
    const src = [
      'export async function GET() {',
      '  // this used to call db.query.users.findFirst and get nothing back',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');
    expect(run(fixture({ 'auth/c/route.ts': src })).out).not.toMatch(/PREAUTH_UNCONTEXTED_READ/);
  });

  it('is statement-level: a file that wraps one read does not exempt its other one', () => {
    const src = [
      "import { db } from '@/drizzle/db';",
      'export async function POST() {',
      '  const [u] = await withAuthLookupContext(async (tx) => await tx.select().from(users).limit(1));',
      '  const s = await db.select().from(sessions).limit(1);',
      '  return Response.json({ u, s });',
      '}',
    ].join('\n');
    const { out } = run(fixture({ 'auth/mixed/route.ts': src }));
    expect(out).toMatch(/PREAUTH_UNCONTEXTED_READ\tapp\/api\/auth\/mixed\/route\.ts:4\s+.*sessions/);
  });
});

describe('the ratchet is shrink-only, and every allowance is owned', () => {
  const site = { 'auth/w/route.ts': BARE_USERS };

  it('a baseline entry tolerates the site, exactly once per statement', () => {
    const { code, out } = run(fixture(site, {
      _reasons: { 'app/api/auth/w/route.ts|PREAUTH_UNCONTEXTED_READ': '#NNNN: reviewed, this route mints its own context elsewhere' },
      'app/api/auth/w/route.ts|PREAUTH_UNCONTEXTED_READ': 1,
    }));
    expect(out).not.toMatch(/PREAUTH_UNCONTEXTED_READ\t/);
    expect(code).toBe(0);
  });

  it('a new un-contexted read past the allowance still fails', () => {
    const two = { 'auth/w/route.ts': `${BARE_USERS}\nconst other = await db.select().from(sessions);` };
    const { code } = run(fixture(two, {
      _reasons: { 'app/api/auth/w/route.ts|PREAUTH_UNCONTEXTED_READ': '#NNNN: one of the two is reviewed' },
      'app/api/auth/w/route.ts|PREAUTH_UNCONTEXTED_READ': 1,
    }));
    expect(code).toBe(1);
  });

  it('an allowance whose site is gone is a finding (BASELINE_STALE)', () => {
    const { out, code } = run(fixture({ 'auth/w/route.ts': WRAPPED_USERS }, {
      _reasons: { 'app/api/auth/w/route.ts|PREAUTH_UNCONTEXTED_READ': 'fixed already' },
      'app/api/auth/w/route.ts|PREAUTH_UNCONTEXTED_READ': 1,
    }));
    expect(code).toBe(1);
    expect(out).toMatch(/BASELINE_STALE/);
  });

  it('an allowance with no reason recorded is a finding (BASELINE_UNREASONED)', () => {
    const { out, code } = run(fixture(site, { 'app/api/auth/w/route.ts|PREAUTH_UNCONTEXTED_READ': 1 }));
    expect(code).toBe(1);
    expect(out).toMatch(/BASELINE_UNREASONED/);
  });

  it('--print-baseline prints, --update writes, and neither fails the screen', () => {
    const d = fixture(site);
    // --baseline is explicit: a fixture must never be able to write the repository's ratchet.
    const here = ['--baseline', 'scripts/rls-preauth-baseline.json'];
    expect(run(d, ['--print-baseline', ...here]).out).toMatch(/app\/api\/auth\/w\/route\.ts\|PREAUTH_UNCONTEXTED_READ/);
    const upd = run(d, ['--update', ...here]);
    expect(upd.code).toBe(0);
    expect(upd.out).toMatch(/wrote/);
  });

  it('explains the rule it enforces', () => {
    const { out, code } = run(dir, ['--explain']);
    expect(code).toBe(0);
    expect(out).toMatch(/PREAUTH_UNCONTEXTED_READ/);
    expect(out).toMatch(/BASELINE_STALE/);
  });
});

describe('the repository as it stands', () => {
  const src = readRepo('app/api/auth/forgot-password/route.ts');

  it('no longer reads users off the pool (#3288 itself)', () => {
    expect(src).not.toMatch(/\bdb\.query\.users\b/);
    expect(src).toMatch(/withAuthLookupContext\(/);
  });

  it('the real tree is clean against the real baseline, and the screen reports what it scanned', () => {
    const { out, code } = run(ROOT);
    expect(out).toMatch(/route/i);
    expect(code, `guard:rls must pass on main + this fix:\n${out}`).toBe(0);
  });

  it('is wired into CI and into the pre-merge gate under the alias that already exists', () => {
    const ci = readRepo('.github/workflows/ci.yml');
    expect(ci).toMatch(/npm run guard:rls/);
    expect(readRepo('package.json')).toMatch(/"guard:rls": "node scripts\/check-rls-route-coverage\.mjs"/);
  });
});

function readRepo(p: string) {
  return readFileSync(join(ROOT, p), 'utf8');
}
