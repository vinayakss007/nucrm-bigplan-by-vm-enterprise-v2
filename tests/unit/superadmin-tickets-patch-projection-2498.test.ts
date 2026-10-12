/**
 * The super-admin ticket PATCH and the row it reads for no reason (#2498 follow-up).
 *
 * #2500 projected the two staff ticket **creates** — `app/api/tenant/tickets/route.ts:126`
 * names 10 columns, `app/api/superadmin/tickets/route.ts:126` names 9 — and its test
 * (`tests/unit/tickets-create-projection-2498.test.ts`) already proves neither response
 * nor the automation payload can carry `portalToken`. This file covers the site that
 * PR did not reach: `app/api/superadmin/tickets/route.ts` line 190 before this change,
 * `.returning()` with no argument — `RETURNING *` over all **23** columns of
 * `support_tickets`, `portal_token` among them, a column the deployed build still
 * fills and that `0124` has not yet made unreachable here.
 *
 * It is a habit, not a leak: the handler tests the row for existence (`:199`) and
 * answers `{ ok: true }` (`:200`), so nothing leaves. But a read is still a read of a
 * bearer-credential column, and no guard sees it — `guard:public-projection` derives
 * its file set from `proxy.ts`'s anonymous surface (#2459), and this is a
 * session-authenticated staff route. A test is the only screen here.
 *
 * The fake **applies** the column map it is handed (`project()`, below), which is what
 * makes the middle tests able to fail: revert `.returning({ id })` to `.returning()`
 * and the handler gets the whole row back, `returningArgs[0]` is `undefined`, and the
 * key-set assertion is the thing that catches it. The first test asserts that property
 * of the fake itself, so a future edit that quietly makes `project()` ignore its
 * argument cannot silently disarm this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const TICKET_ID = '30000000-0000-4000-8000-000000000001';
const PORTAL_TOKEN = 'DZjMXicdnMpyxB1V-qnNWD0RV9D2kLHl';
const UPDATED_AT = new Date('2026-10-10T00:00:00.000Z');

/** What an unprojected `RETURNING *` yields on this table — every column, 23 of them. */
const FULL_ROW: Record<string, unknown> = {
  id: TICKET_ID,
  tenantId: TENANT_ID,
  contactId: null,
  companyId: null,
  dealId: null,
  leadId: null,
  subject: 'probe-ticket',
  body: 'stored text',
  status: 'open',
  priority: 'normal',
  category: 'general',
  assignedTo: null,
  slaPolicyId: null,
  firstResponseAt: null,
  resolvedAt: null,
  portalToken: PORTAL_TOKEN,
  metadata: { resolution: 'operator prose the caller never asked for' },
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  createdBy: USER_ID,
  updatedBy: null,
  deletedAt: null,
  deletedBy: null,
};

/**
 * What the PATCH needs to know: that the row exists. `if (!row)` at
 * `app/api/superadmin/tickets/route.ts:199` is the only consumer, and the response
 * never mentions it, so one column is the whole requirement.
 */
const PATCH_KEYS = ['id'];

/** CamelCase as the driver returns it; `metadata` is #2443's operator-prose column. */
const LEAKED_KEYS = ['portalToken', 'metadata', 'createdBy', 'updatedBy', 'deletedAt', 'deletedBy'];
/** Plus the column name, for the serialized checks. */
const FORBIDDEN_TEXT = [...LEAKED_KEYS, 'portal_token'];

const harness = vi.hoisted(() => {
  const state = {
    updateRows: [] as unknown[],
    existing: [] as unknown[],
    /** Every column map a `.returning()` call in this run was handed. */
    returningArgs: [] as (Record<string, unknown> | undefined)[],
  };
  return { state };
});

/**
 * Ask for columns and you get those keys; ask for none and you get the whole row —
 * the way drizzle's `RETURNING` actually behaves. A fake that ignored the map would
 * turn every assertion below into a restatement of the fixture.
 */
function project(rows: unknown[], columns?: Record<string, unknown>): unknown[] {
  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return columns
      ? Object.fromEntries(Object.keys(columns).map((key) => [key, row[key]]))
      : row;
  });
}

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (columns?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(project(harness.state.existing, columns)) }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: (columns?: Record<string, unknown>) => {
            harness.state.returningArgs.push(columns);
            return Promise.resolve(project(harness.state.updateRows, columns));
          },
        }),
      }),
    }),
  },
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
    isSuperAdmin: true,
    user: { email: 'root@example.com' },
  })),
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
}));

// The optimistic-lock guard reads the row before updating it; that is #1615's business.
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuardById: vi.fn(async () => null),
  concurrencyGuard: vi.fn(async () => null),
  concurrencyGuardAsync: vi.fn(async () => null),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));

function patchRequest(payload: unknown): NextRequest {
  return new Request('http://localhost/api/superadmin/tickets', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

async function patchHandler() {
  const mod = await import('@/app/api/superadmin/tickets/route');
  return mod.PATCH as unknown as (request: NextRequest) => Promise<Response>;
}

describe('the super-admin ticket PATCH names the column it reads (#2498)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.updateRows = [FULL_ROW];
    harness.state.existing = [{ updatedAt: UPDATED_AT }];
    harness.state.returningArgs = [];
  });

  it('the fake really does hand back the whole row when no columns are named', async () => {
    // The screen's own self-check: if `project()` grew an ignoring branch, the two
    // tests below would pass against a route that reads every column again.
    const widened = project([FULL_ROW]) as Record<string, unknown>[];
    const narrowed = project([FULL_ROW], { id: 'anything' }) as Record<string, unknown>[];
    expect(Object.keys(widened[0])).toHaveLength(23);
    expect(widened[0]).toHaveProperty('portalToken', PORTAL_TOKEN);
    expect(Object.keys(narrowed[0])).toEqual(['id']);
  });

  it('the fixture carries everything a projection has to drop', () => {
    // Without this, "no credential in what the handler read" could be an artefact of
    // a thin fixture rather than of the column list.
    expect(Object.keys(FULL_ROW)).toHaveLength(23);
    for (const key of LEAKED_KEYS) expect(FULL_ROW).toHaveProperty(key);
  });

  it('asks the database for a named projection instead of for everything', async () => {
    const PATCH = await patchHandler();
    await PATCH(patchRequest({ id: TICKET_ID, status: 'resolved', resolution: 'fixed it' }));

    expect(harness.state.returningArgs).toHaveLength(1);
    const columns = harness.state.returningArgs[0];
    expect(columns).toBeDefined();
    expect(Object.keys(columns ?? {}).sort()).toEqual([...PATCH_KEYS].sort());
    for (const key of LEAKED_KEYS) expect(columns).not.toHaveProperty(key);
  });

  it('the row it reads back is the existence check and nothing else', async () => {
    const PATCH = await patchHandler();
    await PATCH(patchRequest({ id: TICKET_ID, status: 'open' }));

    // The same projection seen from the handler's side: the object it holds has no
    // credential in it, so a future edit that starts echoing `row` has nothing to leak.
    const readBack = project(harness.state.updateRows, harness.state.returningArgs[0])[0] as Record<string, unknown>;
    expect(Object.keys(readBack).sort()).toEqual([...PATCH_KEYS].sort());
    for (const key of FORBIDDEN_TEXT) expect(JSON.stringify(readBack)).not.toContain(key);
  });

  it('still answers exactly { ok: true } — narrowing the read does not change the contract', async () => {
    const PATCH = await patchHandler();
    const res = await PATCH(patchRequest({ id: TICKET_ID, status: 'resolved' }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe('{"ok":true}');
    expect(text).not.toContain(PORTAL_TOKEN);
    for (const key of FORBIDDEN_TEXT) expect(text).not.toContain(key);
  });

  it('still answers 409 when the guarded update matched no row', async () => {
    // The presence check is the projection's only job, so it has to keep working when
    // the row is absent — `if (!row)` on a one-column RETURNING is the same test.
    harness.state.updateRows = [];
    const PATCH = await patchHandler();
    const res = await PATCH(patchRequest({ id: TICKET_ID, status: 'resolved' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Ticket was modified by another user — please refresh' });
  });
});
