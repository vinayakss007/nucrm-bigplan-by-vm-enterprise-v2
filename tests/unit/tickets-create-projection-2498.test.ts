/**
 * #2498 — the two staff ticket create routes must not echo the whole
 * `support_tickets` row.
 *
 * `.returning()` with no selection is `RETURNING *`: all 23 columns, including
 * the still-live `portal_token` bearer credential. On the tenant route the row
 * additionally fed `evaluateAutomations({ data: { ...row } })`, whose engine
 * persists that payload into `automation_runs.metadata` — a copy DROP COLUMN
 * cannot reach. Both consumers (the Helpdesk create modal, the superadmin
 * list page) only check `res.ok`, so the create response can carry just the
 * fields the caller posted.
 *
 * The insert fake below reproduces drizzle semantics exactly: whole row for
 * `.returning()`, only the selected columns for `.returning({ key: column })`.
 * A route that regressed to `RETURNING *` would therefore fail the response
 * and automation-payload assertions, not just the selection-shape one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const TOKEN = 'live-portal-token-2498-do-not-echo';

const harness = vi.hoisted(() => ({
  returningCalls: [] as unknown[],
  automationPayloads: [] as Record<string, unknown>[],
}));

/** The row as the DATABASE would return it: keyed by column (snake) names. */
const FULL_DB_ROW: Record<string, unknown> = {
  id: 'ticket-1',
  tenant_id: TENANT_ID,
  contact_id: null,
  company_id: null,
  deal_id: null,
  lead_id: null,
  subject: 'probe-ticket',
  body: 'probe body',
  status: 'open',
  priority: 'medium',
  category: 'general',
  assigned_to: null,
  sla_policy_id: null,
  first_response_at: null,
  portal_token: TOKEN,
  metadata: {},
  created_by: USER_ID,
  updated_by: null,
  deleted_by: null,
  deleted_at: null,
  created_at: '2026-10-10T00:00:00.000Z',
  updated_at: '2026-10-10T00:00:00.000Z',
  resolved_at: null,
};

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: (selection?: Record<string, { name: string }>) => {
          harness.returningCalls.push(selection);
          if (!selection) return Promise.resolve([{ ...FULL_DB_ROW }]);
          const out: Record<string, unknown> = {};
          for (const [key, column] of Object.entries(selection)) out[key] = FULL_DB_ROW[column.name];
          return Promise.resolve([out]);
        },
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
vi.mock('@/lib/automation/engine', () => ({
  evaluateAutomations: vi.fn(async (payload: Record<string, unknown>) => {
    harness.automationPayloads.push(payload);
  }),
}));
vi.mock('@/lib/ticket-portal', () => ({ generatePortalToken: vi.fn(() => TOKEN) }));

function post(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

type PostHandler = (request: NextRequest) => Promise<Response>;

const ROUTES: { name: string; url: string; load: () => Promise<PostHandler> }[] = [
  {
    name: 'tenant/tickets',
    url: 'http://localhost/api/tenant/tickets',
    load: async () => (await import('@/app/api/tenant/tickets/route')).POST as unknown as PostHandler,
  },
  {
    name: 'superadmin/tickets',
    url: 'http://localhost/api/superadmin/tickets',
    load: async () => (await import('@/app/api/superadmin/tickets/route')).POST as unknown as PostHandler,
  },
];

describe.each(ROUTES)('#2498 staff ticket create — $name', ({ name, url, load }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.returningCalls = [];
    harness.automationPayloads = [];
  });

  it('asks the database for a named column projection, not RETURNING *', async () => {
    const POST = await load();
    const res = await POST(post(url, { subject: 'probe-ticket', body: 'probe body' }));

    expect(res.status).toBe(201);
    expect(harness.returningCalls).toHaveLength(1);
    const selection = harness.returningCalls[0] as Record<string, { name: string }> | undefined;
    expect(selection, '.returning() with no selection is the #2498 regression').toBeDefined();
    const selectedDbNames = Object.values(selection!).map((c) => c.name);
    expect(selectedDbNames).not.toContain('portal_token');
    expect(selectedDbNames).not.toContain('metadata');
  });

  it('never carries the live portal token in the create response', async () => {
    const POST = await load();
    const res = await POST(post(url, { subject: 'probe-ticket', body: 'probe body' }));
    const text = await res.text();

    expect(res.status).toBe(201);
    expect(text).not.toContain(TOKEN);
    const data = JSON.parse(text) as { data: Record<string, unknown> };
    expect(Object.keys(data.data)).not.toContain('portalToken');
    expect(data.data.id).toBe('ticket-1');
  });

  it('keeps the tenant route automation payload free of the token copy', async () => {
    const POST = await load();
    await POST(post(url, { subject: 'probe-ticket', body: 'probe body' }));
    await new Promise((r) => setTimeout(r, 0));

    if (name !== 'tenant/tickets') return;
    expect(harness.automationPayloads).toHaveLength(1);
    const serialized = JSON.stringify(harness.automationPayloads[0]);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('portalToken');
  });
});
