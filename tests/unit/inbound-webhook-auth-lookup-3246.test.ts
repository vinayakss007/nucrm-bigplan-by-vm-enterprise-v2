/**
 * #3246 step 4a — `POST/GET /api/webhooks/inbound` could not authenticate.
 *
 * `api_keys` is FORCE-RLS and its only non-lookup arm is `tenant_isolation`,
 * keyed on `app.current_tenant`. The route is anonymous (`proxy.ts` lists
 * `/api/webhooks/inbound`), and nothing on that path names a tenant, so
 * `resolveApiKey` read zero rows for every minted key and both handlers answered
 * 401 "Invalid, expired, or inactive API key" before parsing a body. 0099 already
 * shipped the arm this read needed (`api_keys_auth_lookup`), and `tryApiKeyAuth`
 * already uses it for the same table; the route never did.
 *
 * Measured on the dev database as `nucrm_app` (temp FORCE-RLS tables carrying the
 * policy text `pg_policies` reports for these tables, in a rollback, 2026-10-26):
 * the read is 0 rows with no GUC, 1 with `app.auth_lookup`, 0 when the claim names
 * a different hash; the usage-trail UPDATE touches 0 rows under the claim alone
 * and 1 once `app.current_tenant` is named; a contact INSERT raises
 * `new row violates row-level security policy` with no context and lands with it.
 *
 * No migration is needed for this one and none is written. These tests pin that,
 * the order the two contexts are opened in, and the fail-closed half: a key that
 * resolves to nothing must not adopt a workspace.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const USER = '11111111-1111-1111-1111-111111111111';
const ROUTE = 'app/api/webhooks/inbound/route.ts';
const AUTH = 'lib/webhooks/inbound-auth.ts';

interface Call { sql: string; params: unknown[] }

const H = vi.hoisted(() => ({
  calls: [] as unknown[],
  ops: [] as string[],
  row: null as unknown,
}));

function render(f: SQL): Call {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
}

const chain = (table: object) => ({
  set: (values: Record<string, unknown>) => {
    H.ops.push(`update:${getTableName(table as never)}:${Object.keys(values).sort().join(',')}`);
    return { where: async () => ({}) };
  },
});

const findFirst = async (args: { columns?: Record<string, boolean> }) => {
  (H.ops as string[]).push('findFirst');
  (H.calls as unknown[]).push({ sql: '<findFirst>', params: [args.columns] });
  return H.row;
};

// #3291 put a membership proof between adopting the tenant and writing the usage
// trail, so the fixture answers it with a live member. The guarantee itself is
// pinned in api-key-resolver-membership-3291.test.ts; this file is about the two
// RLS contexts #3246 needed, and the proof rides inside a third transaction.
const membershipRead = () => ({
  from: () => ({ where: () => ({ limit: async () => [{ id: 'tm-1' }] }) }),
});

const fakeTx = () => ({
  execute: (f: SQL) => {
    (H.calls as Call[]).push(render(f));
    return Promise.resolve([]);
  },
  update: (table: object) => chain(table),
  select: () => membershipRead(),
  query: { apiKeys: { findFirst } },
});

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (f: SQL) => {
      (H.calls as Call[]).push(render(f));
      return Promise.resolve([]);
    },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      (H.ops as string[]).push('BEGIN');
      return cb(fakeTx());
    },
    query: { apiKeys: { findFirst } },
  },
}));

// The route builds a limiter and imports side-effect modules at load; keep the
// import itself cheap and off the database.
vi.mock('@/lib/rate-limit', () => ({
  RateLimiter: class { async enforce() { /* no-op */ } },
  getRateLimitHeaders: () => ({}),
}));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { request: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const calls = () => H.calls as Call[];
const setConfigs = () => calls().filter((c) => c.sql !== '<findFirst>');

beforeEach(() => {
  H.calls = [];
  H.ops = [];
  H.row = { id: 'k1', tenantId: TENANT, userId: USER, name: 'inbound', prefix: 'ak_te' };
});

describe('the route reads through the claim 0099 already shipped', () => {
  const src = read(ROUTE);
  const auth = read(AUTH);

  it('takes the auth-lookup privilege for the api_keys read, and leaves the bare pool', () => {
    expect(auth).toMatch(/withAuthLookupContext\(\(tx\) => tx\.query\.apiKeys\.findFirst\(/);
    expect(auth).not.toMatch(/\bdb\.query\.apiKeys\b/);
    expect(src, 'the route must not keep a second, unprivileged copy of the lookup').not.toMatch(/apiKeys/);
  });

  it('adopts the key workspace before the usage trail, not after', () => {
    const adopt = auth.indexOf('await setTenantContext(row.tenantId, row.userId ?? NO_USER_SENTINEL)');
    const trail = auth.indexOf('tx.update(apiKeys)');
    expect(adopt, 'the tenant named at lookup time is what the whole handler runs under').toBeGreaterThan(-1);
    expect(trail).toBeGreaterThan(adopt);
    expect(auth, 'a user id is required, and api_keys.user_id is nullable').toContain('NO_USER_SENTINEL');
  });

  it('pins one connection for the request on both handlers', () => {
    expect(src).toMatch(/export async function POST\(request: NextRequest\) \{[\s\S]{0,700}?return withTenantScope\(\(\) => handleInbound\(request\)\);/);
    expect(src).toMatch(/export async function GET\(request: NextRequest\) \{\s*return withTenantScope\(\(\) => handleInboundStats\(request\)\);/);
    expect(src).toMatch(/import \{ withTenantScope \} from '@\/lib\/api\/with-api-route'/);
  });

  it('the guard already recognises the helper, so no deferral is widened for this', async () => {
    const { CONTEXT_HELPERS } = await import('../../scripts/check-portal-rls-context.mts');
    expect(CONTEXT_HELPERS).toContain('withAuthLookupContext');
  });

  it('needs no new policy, and the arm it relies on is the shipped one', () => {
    const up = read('drizzle/migrations/0099_api_keys_auth_lookup.sql');
    expect(up).toMatch(/CREATE POLICY "api_keys_auth_lookup" ON "api_keys" FOR SELECT/);
    expect(up).toMatch(/current_setting\('app\.auth_lookup', true\)/);
    expect(auth).not.toMatch(/CREATE POLICY|DROP POLICY/);
  });
});

describe('resolveApiKey opens exactly the two contexts, in order', () => {
  it('claims the read transaction-locally, then names the tenant and the owner', async () => {
    const { resolveApiKey } = await import('@/lib/webhooks/inbound-auth');
    const row = await resolveApiKey('ak_live_secret-under-test');
    expect(row).toMatchObject({ tenantId: TENANT });
    expect(H.ops).toEqual([
      'BEGIN', 'findFirst',
      // #3291: the membership proof, then the usage trail.
      'BEGIN', 'BEGIN', 'update:api_keys:callCount,lastUsedAt,updatedAt',
    ]);
    const [claim, adopt] = setConfigs();
    // is_local = true: the read privilege must not outlive the lookup.
    expect(claim!.sql).toMatch(/set_config\('app\.auth_lookup', 'true', true\)/);
    expect(claim!.sql, 'the lookup claim names no workspace').not.toMatch(/app\.current_tenant/);
    // is_local = false: the workspace is adopted for the rest of the request.
    expect(adopt!.sql).toMatch(/set_config\('app\.current_tenant', \$1, false\),\s*set_config\('app\.current_user', \$2, false\)/);
    expect(adopt!.params).toEqual([TENANT, USER]);
  });

  it('keeps the credential a WHERE predicate and asks for five columns back', async () => {
    const { resolveApiKey } = await import('@/lib/webhooks/inbound-auth');
    await resolveApiKey('ak_live_secret-under-test');
    const projected = calls().find((c) => c.sql === '<findFirst>')?.params[0] as Record<string, boolean>;
    expect(Object.keys(projected).sort()).toEqual(['id', 'name', 'prefix', 'tenantId', 'userId']);
  });

  it('adopts nothing when the key resolves to no row', async () => {
    H.row = undefined;
    const { resolveApiKey } = await import('@/lib/webhooks/inbound-auth');
    expect(await resolveApiKey('ak_live_nope')).toBeNull();
    expect(H.ops).toEqual(['BEGIN', 'findFirst']);
    const issued = setConfigs().filter((c) => c.sql.includes('app.current_tenant'));
    expect(issued, 'a rejected key must not name a workspace it never proved').toEqual([]);
  });

  it('still names the tenant when the key has no owner, with the nil-uuid user', async () => {
    H.row = { id: 'k2', tenantId: TENANT, userId: null, name: 'svc', prefix: 'ak_sv' };
    const { resolveApiKey } = await import('@/lib/webhooks/inbound-auth');
    const { NO_USER_SENTINEL } = await import('@/lib/db/rls');
    await resolveApiKey('ak_live_ownerless');
    expect(setConfigs()[1]!.params).toEqual([TENANT, NO_USER_SENTINEL]);
  });
});
