/**
 * POST /api/tenant/tickets — #2285
 *
 * Two defects, one payload. `createTicketSchema` let a ticket through without any
 * body text while `support_tickets.body` is NOT NULL, so a schema-valid create
 * died in the INSERT; and clients (the Helpdesk create modal included) send the
 * natural `body` field, which the schema did not know and the route silently
 * dropped — so the same 500 hit callers who HAD supplied text. Then the 500 body
 * echoed drizzle's `Failed query: <full SQL>\nparams: <every bound value>`, which
 * on the dev-mode server disclosed table/column names, the tenant and user UUIDs
 * and the freshly generated one-time portal token.
 *
 * Pinned here: both field names are accepted, a request with no text is a clean
 * 400 with a field-level issue and never reaches the database, and a query the
 * database refuses answers the caller's generic message — the SQLSTATE and
 * constraint go to the server log only, in every environment.
 *
 * #2444 stopped minting a portal token on this insert, so the PORTAL_TOKEN below
 * is no longer "freshly generated" — it is just another bound value standing in
 * for whatever a legacy row still holds, and the rule it proves is unchanged: the
 * driver's query text and its parameters never reach the response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { STAFF_TICKET_COLUMNS } from '@/lib/public-ticket-projection';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const PORTAL_TOKEN = 'DZjMXicdnMpyxB1V-qnNWD0RV9D2kLHl';

/**
 * What `RETURNING *` actually hands the route: every column of
 * `support_tickets` — **23**, measured against a `db:sync` database through
 * `information_schema.columns`. The create response and the automation payload
 * both used to be built from exactly this, which is #2498.
 */
const FULL_ROW: Record<string, unknown> = {
  id: 'ticket-1',
  tenantId: TENANT_ID,
  contactId: null,
  companyId: null,
  dealId: null,
  leadId: null,
  subject: 'probe-ticket',
  body: 'stored text',
  status: 'open',
  priority: 'medium',
  category: 'general',
  assignedTo: null,
  slaPolicyId: null,
  firstResponseAt: null,
  resolvedAt: null,
  portalToken: PORTAL_TOKEN,
  metadata: { resolution: 'operator prose the caller never asked for' },
  createdAt: new Date('2026-10-10T00:00:00.000Z'),
  updatedAt: new Date('2026-10-10T00:00:00.000Z'),
  createdBy: USER_ID,
  updatedBy: null,
  deletedAt: null,
  deletedBy: null,
};

/** The columns `STAFF_TICKET_COLUMNS` names — the same 17, in the same order. */
const STAFF_KEYS = [
  'assignedTo', 'body', 'category', 'contactId', 'createdAt', 'companyId', 'dealId',
  'firstResponseAt', 'id', 'leadId', 'priority', 'resolvedAt', 'slaPolicyId',
  'status', 'subject', 'tenantId', 'updatedAt',
];

const harness = vi.hoisted(() => {
  const state = {
    insertPayloads: [] as Record<string, unknown>[],
    insertRows: [] as unknown[],
    insertError: null as unknown,
    /** The column map each `.returning()` call in this run was handed. */
    returningArgs: [] as (Record<string, unknown> | undefined)[],
  };
  return { state };
});

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }) }),
      }),
    }),
    insert: () => ({
      values: (payload: Record<string, unknown>) => {
        harness.state.insertPayloads.push(payload);
        if (harness.state.insertError) {
          const thrown = harness.state.insertError;
          harness.state.insertError = null;
          throw thrown;
        }
        // `.returning(columns)` narrows the row the way the route asks for it and
        // `.returning()` alone is `RETURNING *`. Applying the list here is the
        // whole point of the #2498 assertions: a fake that ignored it would
        // report a clean response no matter what the route asked the database for.
        return {
          returning: (columns?: Record<string, unknown>) => {
            harness.state.returningArgs.push(columns);
            return Promise.resolve(
              harness.state.insertRows.map((raw) => {
                const row = raw as Record<string, unknown>;
                return columns
                  ? Object.fromEntries(Object.keys(columns).map((key) => [key, row[key]]))
                  : row;
              }));
          },
        };
      },
    }),
  },
}));

// The session module is pulled in transitively (middleware, tenant context).
// Its mock must export BOTH verifyToken and getCurrentUserForToken or the chain
// fails to resolve.
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    isAdmin: true,
    isSuperAdmin: false,
    user: { email: 'agent@example.com' },
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
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/automation/engine', () => ({ evaluateAutomations: vi.fn(async () => undefined) }));
/** Next's generated types freeze NODE_ENV, so set it through Object.assign. */
function setNodeEnv(value: string) {
  Object.assign(process.env, { NODE_ENV: value });
}

function post(payload: unknown): NextRequest {
  return new Request('http://localhost/api/tenant/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

/**
 * The export is `withApiRoute(...)`-typed (request, context); this route never
 * reads the context, and the handler always returns a NextResponse.
 */
async function postHandler(): Promise<(request: NextRequest) => Promise<Response>> {
  const mod = await import('@/app/api/tenant/tickets/route');
  return mod.POST as unknown as (request: NextRequest) => Promise<Response>;
}

/** drizzle's node-postgres failure shape: SQL text as the message, pg error on `cause`. */
function drizzleQueryFailure(): Error {
  const wrapper = new Error(
    `Failed query: insert into "support_tickets" ("id","tenant_id","contact_id","subject","body") `
    + `values (default,$1,$2,$3,$4) returning "id", "portal_token"\n`
    + `params: ${TENANT_ID},,probe-ticket2,open,medium,general,${PORTAL_TOKEN},${USER_ID}`,
  );
  const pg = new Error('null value in column "body" of relation "support_tickets" violates not-null constraint');
  Object.assign(pg, { code: '23502', constraint: 'support_tickets_body_not_null' });
  (wrapper as Error & { cause?: unknown }).cause = pg;
  return wrapper;
}

function inserted(): Record<string, unknown> {
  expect(harness.state.insertPayloads.length).toBeGreaterThan(0);
  return harness.state.insertPayloads[0]!;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('POST /api/tenant/tickets — body/description contract (#2285)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.insertPayloads = [];
    harness.state.insertError = null;
    // The row a projection-free `RETURNING *` really hands back, credential and
    // operator prose included — so the assertions below can only pass by narrowing.
    harness.state.insertRows = [FULL_ROW];
    harness.state.returningArgs = [];
    setNodeEnv('production');
  });

  afterEach(() => {
    setNodeEnv('test');
  });

  it('accepts the natural `body` field and writes it to support_tickets.body', async () => {
    const POST = await postHandler();
    const res = await POST(post({ subject: 'probe-ticket', body: 'probe body' }));

    expect(res.status).toBe(201);
    expect(inserted()).toMatchObject({ body: 'probe body', tenantId: TENANT_ID, createdBy: USER_ID });
  });

  it('still accepts the documented `description` field', async () => {
    const POST = await postHandler();
    const res = await POST(post({ subject: 'probe-ticket', description: 'probe body' }));

    expect(res.status).toBe(201);
    expect(inserted().body).toBe('probe body');
  });

  it('prefers a non-empty description when both names are sent', async () => {
    const POST = await postHandler();
    const res = await POST(post({ subject: 'probe-ticket', description: 'from description', body: 'from body' }));

    expect(res.status).toBe(201);
    expect(inserted().body).toBe('from description');
  });

  it('answers 400 with a field-level issue when neither name carries text', async () => {
    const POST = await postHandler();
    const res = await POST(post({ subject: 'probe-ticket' }));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; details: { field: string }[] };
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual([expect.objectContaining({ field: 'description' })]);
  });

  it('answers 400 for whitespace-only or null body text instead of inserting it', async () => {
    const POST = await postHandler();
    const blank = await POST(post({ subject: 'probe-ticket', body: '   ' }));
    expect(blank.status).toBe(400);

    const nulled = await POST(post({ subject: 'probe-ticket', description: null, body: null }));
    expect(nulled.status).toBe(400);
    expect(harness.state.insertPayloads).toHaveLength(0);
  });

  it('never reaches the database for a request with no body text (the old 500)', async () => {
    const POST = await postHandler();
    await POST(post({ subject: 'probe-ticket' }));

    expect(harness.state.insertPayloads).toHaveLength(0);
  });

  it('keeps the create modal payload working end to end and fires the webhook', async () => {
    const { fireWebhooks } = await import('@/lib/webhooks');
    const POST = await postHandler();
    // Exactly what the Helpdesk create modal in app/tenant/tickets/page.tsx posts.
    const res = await POST(post({ subject: 'Printer on fire', body: 'Page jam on floor 3', priority: 'high', category: 'other' }));
    await flush();

    expect(res.status).toBe(201);
    expect(inserted()).toMatchObject({ body: 'Page jam on floor 3', priority: 'high', category: 'other' });
    expect(fireWebhooks).toHaveBeenCalled();
  });
});

describe('the create response carries no credential and no operator prose (#2498)', () => {
  /**
   * The keys that must never appear in what this route sends out, in the
   * camelCase the row actually arrives in. `portalToken` is the live bearer
   * credential (#2444), `metadata` is where an operator's free-text resolution
   * note lives, and `createdBy`/`updatedBy`/`deletedAt`/`deletedBy` are audit
   * columns the caller never sent. All six are in {@link FULL_ROW}, which is what
   * the fake hands back if the route asks for nothing.
   */
  const LEAKED_KEYS = ['portalToken', 'metadata', 'createdBy', 'updatedBy', 'deletedAt', 'deletedBy'];
  /** Plus the column name, for the serialized checks: a key is text either way. */
  const FORBIDDEN_TEXT = [...LEAKED_KEYS, 'portal_token'];

  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.insertPayloads = [];
    harness.state.insertError = null;
    harness.state.insertRows = [FULL_ROW];
    harness.state.returningArgs = [];
    setNodeEnv('production');
  });

  afterEach(() => {
    setNodeEnv('test');
  });

  it('the fixture itself is leak-capable, so a passing test below means narrowing happened', () => {
    // Without this, "no credential in the response" could be an artefact of a
    // fixture that never carried one rather than of a projection. 23 = every
    // column of the table.
    expect(Object.keys(FULL_ROW)).toHaveLength(23);
    for (const key of LEAKED_KEYS) expect(FULL_ROW).toHaveProperty(key);
  });

  it('asks the database for exactly the staff projection, not for everything', async () => {
    // The textual pin #2443 uses, in two halves. The map is shared with the route,
    // so its key set is stated here rather than re-derived from the response the
    // fake filtered — widening STAFF_TICKET_COLUMNS to add portalToken fails even
    // before the response is looked at. And the call is checked to have carried
    // that map, because a route that dropped it back to `RETURNING *` would
    // otherwise still be caught only by the filtering, not by the asking.
    expect(Object.keys(STAFF_TICKET_COLUMNS).sort()).toEqual([...STAFF_KEYS].sort());
    for (const key of LEAKED_KEYS) expect(STAFF_TICKET_COLUMNS).not.toHaveProperty(key);

    const POST = await postHandler();
    await POST(post({ subject: 'probe-ticket', body: 'probe body' }));
    expect(harness.state.returningArgs).toHaveLength(1);
    expect(Object.keys(harness.state.returningArgs[0] ?? {}).sort()).toEqual([...STAFF_KEYS].sort());
  });

  it('returns 17 ticket fields and nothing else', async () => {
    const POST = await postHandler();
    const res = await POST(post({ subject: 'probe-ticket', body: 'probe body' }));
    const body = await res.json() as { data: Record<string, unknown> };

    expect(res.status).toBe(201);
    expect(Object.keys(body.data).sort()).toEqual([...STAFF_KEYS].sort());
    expect(body.data.subject).toBe('probe-ticket');
  });

  it('the serialized create response carries no credential, prose or audit column', async () => {
    const POST = await postHandler();
    const res = await POST(post({ subject: 'probe-ticket', body: 'probe body' }));
    const text = await res.text();

    expect(text).not.toContain(PORTAL_TOKEN);
    // The value, not just the key name: `metadata.resolution` is the operator's
    // note, and an echo of it is what #2443 removed from the customer's detail page.
    expect(text).not.toContain('operator prose');
    expect(text).not.toContain('resolution');
    for (const key of FORBIDDEN_TEXT) expect(text).not.toContain(key);
  });

  it('the automation payload is the same projected row, so automation_runs stores no credential', async () => {
    // `evaluateAutomations()` persists `payload.data` as `automation_runs.metadata`
    // (lib/automation/engine.ts:96, :109) and POSTs it to any `fire_webhook` action
    // (lib/automation/engine.ts:314). The response was always the smaller audience.
    const { evaluateAutomations } = await import('@/lib/automation/engine');
    const POST = await postHandler();
    await POST(post({ subject: 'probe-ticket', body: 'probe body' }));
    await flush();

    expect(evaluateAutomations).toHaveBeenCalledTimes(1);
    const payload = (evaluateAutomations as unknown as { mock: { calls: { data: Record<string, unknown> }[] } }).mock.calls[0]![0];
    expect(Object.keys(payload.data).sort()).toEqual([...STAFF_KEYS].sort());
    const serialized = JSON.stringify(payload.data);
    expect(serialized).not.toContain(PORTAL_TOKEN);
    expect(serialized).not.toContain('operator prose');
    for (const key of FORBIDDEN_TEXT) expect(serialized).not.toContain(key);
  });
});

describe('apiError never echoes a failed query (#2285)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.insertPayloads = [];
    harness.state.insertError = null;
  });

  afterEach(() => {
    harness.state.insertError = null;
    setNodeEnv('test');
  });

  it('strips the SQL statement and its bound values from a dev-mode 500', async () => {
    setNodeEnv('development');
    harness.state.insertError = drizzleQueryFailure();
    const POST = await postHandler();

    const res = await POST(post({ subject: 'probe-ticket', description: 'probe body' }));
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain('Failed query');
    expect(text).not.toContain('insert into');
    expect(text).not.toContain('values (default');
    expect(text).not.toContain('params:');
    expect(text).not.toContain('$1');
    expect(text).not.toContain(PORTAL_TOKEN);
    expect(text).not.toContain(TENANT_ID);
    expect(text).not.toContain(USER_ID);
    // No driver text at all — even the SQLSTATE and constraint, which identify
    // the table and column, stay in the server log and never the response.
    expect(text).not.toContain('23502');
    expect(text).not.toContain('support_tickets_body_not_null');
    expect(text).not.toContain('not-null constraint');
    // The caller-visible outcome: the route's own fixed, generic message.
    expect(text).toContain('Failed to create ticket');
  });

  it('returns the generic create failure in production', async () => {
    setNodeEnv('production');
    harness.state.insertError = drizzleQueryFailure();
    const POST = await postHandler();

    const res = await POST(post({ subject: 'probe-ticket', description: 'probe body' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to create ticket' });
  });

  it('still keeps the useful dev message for an ordinary error', async () => {
    // The filter is scoped to query failures: a plain thrown error stays readable
    // in development, which is why that branch existed.
    setNodeEnv('development');
    const { apiError } = await import('@/lib/api-error');

    const res = apiError(new Error('a plain developer-facing note'), 'generic', 500);

    expect(await res.json()).toEqual({ error: 'a plain developer-facing note' });
  });

  it('maps a raw Postgres error without the drizzle wrapper to code + constraint', async () => {
    setNodeEnv('development');
    const { apiError } = await import('@/lib/api-error');
    const raw = new Error('duplicate key value violates unique constraint "support_tickets_pkey"');
    Object.assign(raw, { code: '23505', constraint: 'support_tickets_pkey' });

    const res = apiError(raw, 'generic', 500);
    const text = await res.text();

    // 23505 is a client-caused class, so the existing classifier answers 409 —
    // with its own fixed text; the constraint name stays in the log.
    expect(res.status).toBe(409);
    expect(text).not.toContain('support_tickets_pkey');
    expect(text).not.toContain('duplicate key');
  });
});
