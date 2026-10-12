/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2406 — POST /api/webhooks/resend writes inside ONE workspace.
 *
 * The payload names a recipient, not a tenant, and `contacts.email` is not
 * globally unique: two customers may hold the same person. Before this fix a
 * single hard bounce set `do_not_contact = true` on every tenant holding the
 * address and cancelled those tenants' active sequence enrollments in the same
 * transaction — silently, with no audit row for the customer who lost the
 * mailing. These tests assert on the *rendered* SQL (the #2391 technique) so
 * the tenant predicate is what fails, not a mocked return value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { NextRequest } from 'next/server';
import { contacts, sequenceEnrollments } from '@/drizzle/schema';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const ADDRESS = 'shared@example.com';
const EMAIL_ID = 'evt_4444444444444444';

const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as never).sql;
const paramsOf = (node: unknown) => dialect.sqlToQuery(node as never).params;

type Recorded = { kind: string; table: unknown; where?: unknown };

const h = vi.hoisted(() => ({
  nodes: [] as Array<Recorded>,
  order: [] as string[],
  // What `.returning()` answers. A hard bounce only reaches the enrollment
  // cancellation when the contact UPDATE matched a row, so cases set this.
  returning: [] as unknown[],
  selectRows: [] as unknown[],
}));

function makeChain(kind: string, table: unknown): Record<string, unknown> {
  let where: unknown;
  const record = () => {
    h.order.push(kind);
    h.nodes.push({ kind, table, where });
  };
  const self: Record<string, unknown> = {
    set: () => self,
    from: (t: unknown) => makeChain(kind, t),
    where: (w: unknown) => { where = w; record(); return self; },
    limit: () => self,
    groupBy: () => self,
    orderBy: () => self,
    for: () => self,
    values: () => self,
    returning: () => { record(); return Promise.resolve(h.returning); },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      record();
      return Promise.resolve(kind === 'select' ? h.selectRows : [{}]).then(res, rej);
    },
  };
  return self;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => makeChain('select', undefined),
    update: (t: unknown) => makeChain('update', t),
    insert: (t: unknown) => makeChain('insert', t),
    transaction: (fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
      fn({
        select: () => makeChain('select', undefined),
        update: (t: unknown) => makeChain('update', t),
        insert: (t: unknown) => makeChain('insert', t),
      }),
  },
}));

const mockRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

// The resolver has its own suite (resend-webhook-scope-2406.test.ts); here each
// verdict is planted so the write scope is pinned independently of the policy.
const mockResolveScope = vi.fn();
vi.mock('@/lib/email/webhook-scope', () => ({
  resolveRecipientScope: (...args: unknown[]) => {
    h.order.push('resolve');
    return mockResolveScope(...args);
  },
}));

const mockLogError = vi.fn();
vi.mock('@/lib/errors-server', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const recentBounce = new Date(Date.now() - 60_000).toISOString();

function post(payload: unknown): NextRequest {
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

function event(type: string, data: Record<string, unknown> = {}) {
  return post({ type, data: { email_id: EMAIL_ID, to: [ADDRESS], created_at: new Date().toISOString(), ...data } });
}

const writesOn = (table: unknown, kind = 'update') =>
  h.nodes.filter((n) => n.kind === kind && n.table === table);

const contactSelects = () =>
  h.nodes.filter((n) => n.kind === 'select' && n.table === contacts && n.where !== undefined);

beforeEach(() => {
  vi.clearAllMocks();
  h.nodes.length = 0;
  h.order.length = 0;
  h.returning = [];
  h.selectRows = [];
  mockRateLimit.mockResolvedValue(null);
  // Signature verification is #1430's own suite; a set secret here would 401
  // every request before attribution was reached.
  delete process.env.RESEND_WEBHOOK_SECRET;
});

describe('attribution happens before any write (#2406)', () => {
  it('resolves the workspace before it touches the database', async () => {
    h.returning = [{ id: CONTACT, tenantId: TENANT_A, firstName: 'Ada' }];
    mockResolveScope.mockResolvedValue({ kind: 'tenant', tenantId: TENANT_A });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(event('email.bounced', { bounce_type: 'hard' }));

    expect(res.status).toBe(200);
    expect(mockResolveScope).toHaveBeenCalledTimes(1);
    expect(mockResolveScope.mock.calls[0]![0]).toEqual({ emailId: EMAIL_ID, recipient: ADDRESS });
    expect(h.order[0], 'attribution is not the first thing this handler does').toBe('resolve');
    expect(h.order.indexOf('update'), 'a write ran before attribution').toBeGreaterThan(0);
  });

  it('drops an unattributable event without writing anything', async () => {
    mockResolveScope.mockResolvedValue({
      kind: 'unattributed', reason: 'ambiguous', candidates: [TENANT_A, TENANT_B],
    });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(event('email.bounced', { bounce_type: 'hard' }));

    expect(await res.json()).toEqual({ received: true, attributed: false });
    expect(writesOn(contacts)).toEqual([]);
    expect(writesOn(sequenceEnrollments)).toEqual([]);
    expect(mockLogError).toHaveBeenCalledTimes(1);

    const opts = mockLogError.mock.calls[0]![0] as {
      context: string; level: string; captureToSentry: boolean; metadata: Record<string, unknown>;
    };
    expect(opts.context).toBe('resend-webhook:unattributed');
    expect(opts.level).toBe('warning');
    expect(opts.captureToSentry).toBe(false);
    expect(opts.metadata.candidates).toEqual([TENANT_A, TENANT_B]);
    expect(opts.metadata.emailId).toBe(EMAIL_ID);
  });

  it('records the drop without the recipient local part', async () => {
    mockResolveScope.mockResolvedValue({ kind: 'unattributed', reason: 'no-send-record', candidates: [] });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.complained'));

    const opts = mockLogError.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(opts.metadata.recipientDomain).toBe('example.com');
    expect(JSON.stringify(opts.metadata)).not.toContain('shared');
  });
});

describe('hard bounce / complaint (#2406)', () => {
  it('binds tenant_id into the contact suppression', async () => {
    h.returning = [{ id: CONTACT, tenantId: TENANT_A, firstName: 'Ada' }];
    mockResolveScope.mockResolvedValue({ kind: 'tenant', tenantId: TENANT_A });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.bounced', { bounce_type: 'hard' }));

    const suppression = writesOn(contacts);
    expect(suppression.length, 'no DNC write ran').toBeGreaterThan(0);
    expect(render(suppression[0]!.where)).toContain('"tenant_id"');
    expect(paramsOf(suppression[0]!.where)).toContain(TENANT_A);
  });

  it('narrows to the exact contact when the send identified it', async () => {
    h.returning = [{ id: CONTACT, tenantId: TENANT_A, firstName: 'Ada' }];
    mockResolveScope.mockResolvedValue({ kind: 'exact', tenantId: TENANT_A, contactId: CONTACT });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.bounced', { bounce_type: 'hard' }));

    const where = writesOn(contacts)[0]!.where;
    expect(render(where)).toContain('"contacts"."id"');
    expect(paramsOf(where)).toEqual(expect.arrayContaining([TENANT_A, CONTACT, ADDRESS]));
  });

  it('binds tenant_id into the enrollment cancellation', async () => {
    h.returning = [{ id: CONTACT, tenantId: TENANT_A, firstName: 'Ada' }];
    mockResolveScope.mockResolvedValue({ kind: 'tenant', tenantId: TENANT_A });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.bounced', { bounce_type: 'hard' }));

    const cancelled = writesOn(sequenceEnrollments);
    expect(cancelled.length, 'no enrollment cancellation ran').toBeGreaterThan(0);
    expect(render(cancelled[0]!.where)).toContain('"tenant_id"');
    expect(paramsOf(cancelled[0]!.where)).toContain(TENANT_A);
  });

  it('treats a complaint with the same scope', async () => {
    h.returning = [{ id: CONTACT, tenantId: TENANT_A, firstName: 'Ada' }];
    mockResolveScope.mockResolvedValue({ kind: 'tenant', tenantId: TENANT_A });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.complained'));
    expect(paramsOf(writesOn(contacts)[0]!.where)).toContain(TENANT_A);
  });
});

describe('soft bounce escalation (#2406)', () => {
  beforeEach(() => {
    h.selectRows = [{ id: CONTACT, tenantId: TENANT_A, metadata: { softBounces: [recentBounce, recentBounce] } }];
    mockResolveScope.mockResolvedValue({ kind: 'tenant', tenantId: TENANT_A });
  });

  it('reads only the addressed workspace, at every step', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.bounced', { bounce_type: 'soft' }));

    const selects = contactSelects();
    expect(selects.length, 'the soft-bounce path read no contact').toBeGreaterThan(0);
    for (const s of selects) {
      expect(render(s.where), 'a contact read is not tenant scoped').toContain('"tenant_id"');
      expect(paramsOf(s.where)).toContain(TENANT_A);
    }
  });

  it('binds tenant_id into the escalated suppression and cancellation', async () => {
    h.returning = [{ id: CONTACT, tenantId: TENANT_A }];
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.bounced', { bounce_type: 'soft' }));

    // Two bounces inside the window plus this one crosses the threshold, so
    // both writes must have happened — each one tenant-bound.
    const suppression = writesOn(contacts);
    expect(suppression.length, 'escalation wrote no contact').toBeGreaterThan(0);
    for (const w of suppression) {
      expect(render(w.where)).toContain('"tenant_id"');
      expect(paramsOf(w.where)).toContain(TENANT_A);
    }
    const cancelled = writesOn(sequenceEnrollments);
    expect(cancelled.length, 'escalation cancelled no enrollment').toBeGreaterThan(0);
    expect(render(cancelled[0]!.where)).toContain('"tenant_id"');
  });
});

describe('reply (#2406)', () => {
  it('stops follow-ups in the addressed workspace only', async () => {
    h.selectRows = [{ id: CONTACT, tenantId: TENANT_A }];
    h.returning = [{ id: 'enrollment-1' }];
    mockResolveScope.mockResolvedValue({ kind: 'tenant', tenantId: TENANT_A });
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(event('email.replied'));

    // This handler used to `.limit(1)` across every tenant holding the address
    // and completed whichever row Postgres returned first.
    const selects = contactSelects();
    expect(selects.length, 'the reply read no contact').toBeGreaterThan(0);
    expect(render(selects[0]!.where)).toContain('"tenant_id"');
    expect(paramsOf(selects[0]!.where)).toContain(TENANT_A);

    const cancelled = writesOn(sequenceEnrollments);
    expect(cancelled.length, 'the reply cancelled nothing').toBeGreaterThan(0);
    expect(render(cancelled[0]!.where)).toContain('"tenant_id"');
    expect(paramsOf(cancelled[0]!.where)).toContain(TENANT_A);
  });
});

describe('controls (#2406)', () => {
  it('an event with no recipient is neither attributed nor written', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(post({
      type: 'email.bounced',
      data: { email_id: EMAIL_ID, to: [], created_at: new Date().toISOString(), bounce_type: 'hard' },
    }));
    expect(res.status).toBe(200);
    expect(mockResolveScope).not.toHaveBeenCalled();
    expect(h.nodes).toEqual([]);
  });

  it('a delivery event writes nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(event('email.delivered'));
    expect(res.status).toBe(200);
    expect(mockResolveScope).not.toHaveBeenCalled();
    expect(h.nodes).toEqual([]);
  });

  it('an unrecognized event type is accepted and ignored', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(event('email.bogus'));
    expect(res.status).toBe(200);
    expect(mockResolveScope).not.toHaveBeenCalled();
    expect(h.nodes).toEqual([]);
  });

  it('the limiter still runs first', async () => {
    const tooMany = new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
    mockRateLimit.mockResolvedValue(tooMany);
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(event('email.bounced', { bounce_type: 'hard' }));
    expect(res).toBe(tooMany);
    expect(mockResolveScope).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
  });
});
