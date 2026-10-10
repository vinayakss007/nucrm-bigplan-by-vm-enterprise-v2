/**
 * Super-admin ticket writes and the row they hand back (#2498).
 *
 * `app/api/superadmin/tickets/route.ts` had the same habit as the tenant route:
 * `.returning()` with no column list, which is `RETURNING *` — all 23 columns of
 * `support_tickets`, `portal_token` included, and for POST that row is the
 * response body (`{ data: row }`). #2443 gave the public detail route a named
 * projection for exactly this reason; this is the staff-side copy of that fix,
 * measured through the same fake, which applies the column map the route asks for
 * rather than handing back whatever the fixture held.
 *
 * #2444 stopped minting a token on this insert, which is not the same as narrowing
 * the echo: the column is still there until the owner drops it, and the build that
 * is actually deployed still fills it.
 *
 * PATCH is here too because it is the third unprojected `.returning()` in the
 * file. Its row never leaves — the handler answers `{ ok: true }` — so it is not
 * a leak, but an argument-less `RETURNING` on this table is a read of a column
 * that holds a bearer credential, and `guard:public-projection` cannot see it:
 * its scope is `proxy.ts`'s anonymous surface (#2459) and these are
 * session-authenticated staff routes. A test is the only screen this file has.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { STAFF_TICKET_COLUMNS } from '@/lib/public-ticket-projection';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const TICKET_ID = '30000000-0000-4000-8000-000000000001';
const PORTAL_TOKEN = 'DZjMXicdnMpyxB1V-qnNWD0RV9D2kLHl';
const UPDATED_AT = new Date('2026-10-10T00:00:00.000Z');

/** What an unprojected `RETURNING *` actually yields — every column, 23 of them. */
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

/** The 17 columns `STAFF_TICKET_COLUMNS` names, written out independently. */
const STAFF_KEYS = [
  'assignedTo', 'body', 'category', 'contactId', 'createdAt', 'companyId', 'dealId',
  'firstResponseAt', 'id', 'leadId', 'priority', 'resolvedAt', 'slaPolicyId',
  'status', 'subject', 'tenantId', 'updatedAt',
];

/** Row keys that must never be sent, in the camelCase the driver returns. */
const LEAKED_KEYS = ['portalToken', 'metadata', 'createdBy', 'updatedBy', 'deletedAt', 'deletedBy'];
/** Plus the column name itself, for the serialized checks. */
const FORBIDDEN_TEXT = [...LEAKED_KEYS, 'portal_token'];

const harness = vi.hoisted(() => {
  const state = {
    insertRows: [] as unknown[],
    updateRows: [] as unknown[],
    existing: [] as unknown[],
    /** Every column map a `.returning()` call in this run was handed. */
    returningArgs: [] as (Record<string, unknown> | undefined)[],
  };
  return { state };
});

/**
 * The projection, applied by the fake rather than asserted afterwards: ask for
 * columns and you get those keys; ask for none and you get the whole row. This is
 * the difference between a test that can fail and a test that only looks thorough.
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
    insert: () => ({
      values: () => ({
        returning: (columns?: Record<string, unknown>) => {
          harness.state.returningArgs.push(columns);
          return Promise.resolve(project(harness.state.insertRows, columns));
        },
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

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));
// The optimistic-lock guard reads the row twice; it is #1615's business, not #2498's.
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuardById: vi.fn(async () => null),
  concurrencyGuard: vi.fn(async () => null),
  concurrencyGuardAsync: vi.fn(async () => null),
}));

function jsonRequest(method: 'POST' | 'PATCH', payload: unknown): NextRequest {
  return new Request('http://localhost/api/superadmin/tickets', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

async function handlers() {
  const mod = await import('@/app/api/superadmin/tickets/route');
  return {
    POST: mod.POST as unknown as (request: NextRequest) => Promise<Response>,
    PATCH: mod.PATCH as unknown as (request: NextRequest) => Promise<Response>,
  };
}

describe('super-admin ticket writes name their projection (#2498)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.insertRows = [FULL_ROW];
    harness.state.updateRows = [FULL_ROW];
    harness.state.existing = [{ updatedAt: UPDATED_AT }];
    harness.state.returningArgs = [];
  });

  it('the fixture carries everything the projection must drop', () => {
    // Without this the six assertions below could be satisfied by an empty row.
    expect(Object.keys(FULL_ROW)).toHaveLength(23);
    for (const key of LEAKED_KEYS) expect(FULL_ROW).toHaveProperty(key);
  });

  it('the shared map is the 17 business columns and nothing else', () => {
    expect(Object.keys(STAFF_TICKET_COLUMNS).sort()).toEqual([...STAFF_KEYS].sort());
    for (const key of LEAKED_KEYS) expect(STAFF_TICKET_COLUMNS).not.toHaveProperty(key);
  });

  it('POST asks the database for the named projection', async () => {
    const { POST } = await handlers();
    await POST(jsonRequest('POST', { subject: 'probe-ticket', body: 'probe body' }));

    expect(harness.state.returningArgs).toHaveLength(1);
    expect(Object.keys(harness.state.returningArgs[0] ?? {}).sort()).toEqual([...STAFF_KEYS].sort());
  });

  it('POST returns 17 ticket fields, no credential and no operator prose', async () => {
    const { POST } = await handlers();
    const res = await POST(jsonRequest('POST', { subject: 'probe-ticket', body: 'probe body' }));
    const text = await res.text();

    expect(res.status).toBe(201);
    const body = JSON.parse(text) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual([...STAFF_KEYS].sort());
    expect(text).not.toContain(PORTAL_TOKEN);
    expect(text).not.toContain('operator prose');
    for (const key of FORBIDDEN_TEXT) expect(text).not.toContain(key);
  });

  it('PATCH asks for the projection too, even though its row never leaves', async () => {
    const { PATCH } = await handlers();
    const res = await PATCH(jsonRequest('PATCH', { id: TICKET_ID, status: 'resolved', resolution: 'fixed it' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(harness.state.returningArgs).toHaveLength(1);
    expect(Object.keys(harness.state.returningArgs[0] ?? {}).sort()).toEqual([...STAFF_KEYS].sort());
  });

  it('the PATCH response stays { ok: true } with nothing of the row in it', async () => {
    const { PATCH } = await handlers();
    const res = await PATCH(jsonRequest('PATCH', { id: TICKET_ID, status: 'resolved' }));
    const text = await res.text();

    expect(text).toBe('{"ok":true}');
    expect(text).not.toContain(PORTAL_TOKEN);
    for (const key of FORBIDDEN_TEXT) expect(text).not.toContain(key);
  });
});
