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

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const PORTAL_TOKEN = 'DZjMXicdnMpyxB1V-qnNWD0RV9D2kLHl';

const harness = vi.hoisted(() => {
  const state = {
    insertPayloads: [] as Record<string, unknown>[],
    insertRows: [] as unknown[],
    insertError: null as unknown,
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
        return { returning: () => Promise.resolve(harness.state.insertRows) };
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
    harness.state.insertRows = [{
      id: 'ticket-1',
      tenantId: TENANT_ID,
      subject: 'probe-ticket',
      body: 'stored text',
      priority: 'medium',
      status: 'open',
      contactId: null,
      portalToken: PORTAL_TOKEN,
    }];
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
