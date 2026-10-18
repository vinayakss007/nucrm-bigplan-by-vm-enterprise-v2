/**
 * #2562 — `PATCH /api/tenant/plugin-engine` assigned `body.config` straight onto the
 * `integrations.config` JSONB column. Because `GET` on the same route withholds every
 * `SECRET_CONFIG_KEY` name (#2559, `lib/integrations/config-credentials.ts`), the
 * documented read→edit→write cycle (`app/tenant/docs/page.tsx:84-87`) answered
 * `success: true` after deleting the tenant's webhook signing secret and its calendar
 * refresh token.
 *
 * The fake returns the stored bag for the merge read, exactly as Postgres would, so the
 * only thing that can keep a credential alive across a PATCH is the handler's merge. The
 * assertions are on the value handed to `.set()` — that is the column write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const ROW_ID = '30000000-0000-4000-8000-000000000001';
const MISSING_ROW_ID = '30000000-0000-4000-8000-000000000099';
const UPDATED_AT = new Date('2026-10-10T00:00:00.000Z');

const SIGNING_SECRET = 'whsec_live_DO-NOT-DELETE-VIA-PATCH';
const REFRESH_TOKEN = '1//v4-refresh-DO-NOT-DELETE-VIA-PATCH';
const ACCESS_TOKEN = 'ya29.access-DO-NOT-DELETE-VIA-PATCH';
const ROTATED_SECRET = 'whsec_live_ROTATED-BY-THE-CALLER';

type StoredRow = {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
};

const WEBHOOK_ROW: StoredRow = {
  id: ROW_ID,
  tenantId: TENANT_ID,
  type: 'webhook',
  name: 'Billing hook',
  config: { url: 'https://customer.example/recv', events: ['invoice.paid'], secret: SIGNING_SECRET },
  isActive: true,
};

const CALENDAR_ROW: StoredRow = {
  id: '40000000-0000-4000-8000-000000000001',
  tenantId: TENANT_ID,
  type: 'google',
  name: 'Workspace calendar',
  config: { calendarId: 'primary', syncEnabled: true, accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN },
  isActive: true,
};

const harness = vi.hoisted(() => ({
  state: {
    rows: [] as Record<string, unknown>[],
    setCalls: [] as Record<string, unknown>[],
    whereArgs: [] as unknown[],
    projections: [] as Record<string, unknown>[] | unknown[],
  },
}));

/**
 * `withApiRoute` pins a tenant connection around the handler
 * (`lib/api/with-api-route.ts:130`); passing it straight through is what lets the
 * wrapped export be called as a plain function here.
 */
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (projection?: Record<string, unknown>) => {
      harness.state.projections.push(projection);
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = (predicate: unknown) => {
        harness.state.whereArgs.push(predicate);
        return chain;
      };
      // `.limit(1)` on this table is only ever reached after the tenant + id
      // predicate, and the fake holds the one row that predicate is about.
      const resolve = () =>
        Promise.resolve(
          harness.state.rows.map((row) =>
            projection ? Object.fromEntries(Object.keys(projection).map((k) => [k, row[k]])) : { ...row },
          ),
        );
      chain.orderBy = resolve;
      chain.limit = resolve;
      return chain;
    },
    update: () => ({
      set: (updates: Record<string, unknown>) => {
        harness.state.setCalls.push(updates);
        return {
          where: (predicate: unknown) => {
            harness.state.whereArgs.push(predicate);
            return { returning: () => Promise.resolve([{ id: ROW_ID, updatedAt: UPDATED_AT }]) };
          },
        };
      },
    }),
  },
}));

vi.mock('@/lib/integrations/registry', () => ({
  getAllProviders: vi.fn(() => []),
  getProviderDef: vi.fn(() => undefined),
}));

vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    isAdmin: true,
    user: { email: 'rep@example.com' },
  })),
  requireCsrf: vi.fn(() => null),
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));

async function patch() {
  const mod = await import('@/app/api/tenant/plugin-engine/route');
  return mod.PATCH as unknown as (request: NextRequest) => Promise<Response>;
}

function patchRequest(payload: unknown): NextRequest {
  return new Request('http://localhost/api/tenant/plugin-engine', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

/** The bag `GET` answers for a row: credentials removed, names reported. */
function readBag(row: StoredRow): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.config)) {
    if (/(secret|token|password|api[_-]?key|credential|access[_-]?key)/i.test(key)) continue;
    config[key] = value;
  }
  return config;
}

function lastWrittenConfig(): Record<string, unknown> {
  return harness.state.setCalls.at(-1)!.config as Record<string, unknown>;
}

/**
 * Drizzle predicates are circular `SQL` objects (`queryChunks` -> column -> table ->
 * column), so they cannot be stringified. Flattening the chunks is what lets a test
 * assert on the literal a `where` actually binds.
 */
function predicateText(predicate: unknown): string {
  const walk = (node: unknown): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(walk).join(' ');
    const holder = node as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(holder.queryChunks)) return holder.queryChunks.map(walk).join(' ');
    return holder.value === undefined ? '' : String(holder.value);
  };
  return walk(predicate);
}

describe('plugin-engine PATCH merges config instead of replacing the credential bag (#2562)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.rows = [{ ...WEBHOOK_ROW }];
    harness.state.setCalls = [];
    harness.state.whereArgs = [];
    harness.state.projections = [];
  });

  it('survives the documented read→edit→write cycle with the signing secret intact', async () => {
    const PATCH = await patch();
    const res = await PATCH(
      patchRequest({ id: ROW_ID, config: { ...readBag(WEBHOOK_ROW), url: 'https://customer.example/recv2' } }),
    );

    expect(res.status).toBe(200);
    expect(lastWrittenConfig()).toEqual({
      url: 'https://customer.example/recv2',
      events: ['invoice.paid'],
      secret: SIGNING_SECRET,
    });
  });

  it('keeps an OAuth token pair a masked client could not have echoed', async () => {
    harness.state.rows = [{ ...CALENDAR_ROW }];
    const PATCH = await patch();
    await PATCH(patchRequest({ id: CALENDAR_ROW.id, config: { ...readBag(CALENDAR_ROW), calendarId: 'work' } }));

    expect(lastWrittenConfig()).toEqual({
      calendarId: 'work',
      syncEnabled: true,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
    });
  });

  it('still lets a caller who holds the credential rotate it', async () => {
    const PATCH = await patch();
    await PATCH(patchRequest({ id: ROW_ID, config: { secret: ROTATED_SECRET } }));

    expect(lastWrittenConfig()['secret']).toBe(ROTATED_SECRET);
    // Rotation is not a replacement: the settings the caller did not name stay.
    expect(lastWrittenConfig()['url']).toBe('https://customer.example/recv');
  });

  it('reads only the config column, tenant-scoped', async () => {
    const PATCH = await patch();
    await PATCH(patchRequest({ id: ROW_ID, config: { url: 'https://customer.example/third' } }));

    // #2563's discipline applies to the new read too: a projection, not the whole row.
    expect(harness.state.projections[0]).toEqual({ config: expect.anything() });
    // The merge read and the UPDATE both carry predicates, both tenant-scoped.
    expect(harness.state.whereArgs).toHaveLength(2);
    for (const predicate of harness.state.whereArgs) {
      expect(predicateText(predicate)).toContain(TENANT_ID);
    }
  });

  it('rejects a non-object config rather than storing a scalar over the bag', async () => {
    const PATCH = await patch();
    const res = await PATCH(patchRequest({ id: ROW_ID, config: 'https://customer.example' }));

    expect(res.status).toBe(400);
    expect(harness.state.setCalls).toHaveLength(0);
  });

  it('merges against nothing when the id is not in this tenant reach', async () => {
    // The merge read is `where(tenantId = ctx.tenantId AND id = body.id)`, so a
    // missing or foreign id yields no row and the caller's bag stands alone; the
    // UPDATE's own tenant predicate then matches nothing. Nothing from another
    // tenant's bag can enter the merge, and nothing of this tenant's is deleted.
    harness.state.rows = [];
    const PATCH = await patch();
    const res = await PATCH(patchRequest({ id: MISSING_ROW_ID, config: { url: 'https://attacker.example' } }));

    expect(res.status).toBe(200);
    expect(harness.state.setCalls.at(-1)!.config).toEqual({ url: 'https://attacker.example' });
  });

  it('leaves a name-only PATCH untouched by the merge', async () => {
    const PATCH = await patch();
    await PATCH(patchRequest({ id: ROW_ID, name: 'Renamed hook' }));

    expect(harness.state.setCalls.at(-1)).toEqual({ name: 'Renamed hook' });
    expect(harness.state.whereArgs).toHaveLength(1);
  });
});
