/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2440 — a public ticket write must not echo the row it created.
 *
 * `POST /api/public/tickets` minted a `portal_token` and returned
 * `.returning()` — `RETURNING *` — so the anonymous embed caller received a
 * bearer credential that `GET /api/public/tickets` accepts for the contact's
 * whole ticket history. #2217 had already redacted that column from the
 * customer-facing detail response; the create path was never covered.
 *
 * #2444 retired the credential itself: nothing is minted on INSERT any more, and
 * 0124 dropped the RLS arm that let a stored `portal_token` match a row. The
 * fixture below still carries one, deliberately — pre-#2442 rows hold those
 * values, and the projection rule that keeps them out of the response is exactly
 * what this file is for.
 *
 * These tests emulate drizzle's projection rule rather than asserting on a
 * hand-written response object: `.returning()` with no selection yields the
 * whole row, `.returning({ key: column })` yields exactly those columns. So if
 * the projection is ever widened back to `*`, the token reappears in the body
 * and the test fails for the real reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TOKEN = 'MINTED-TOKEN-SECRET-DO-NOT-ECHO';
const TENANT = '11111111-1111-4111-8111-111111111111';

const findFirstMock = vi.fn();
const returningMock = vi.fn();
const valuesMock = vi.fn();
const mockIdentity = { current: null as unknown };
const mockContact = { current: null as unknown };

/** The row as the database holds it, keyed by column name. */
const TICKET_ROW: Record<string, unknown> = {
  id: 'tick1',
  tenant_id: TENANT,
  contact_id: 'c1',
  company_id: 'co1',
  deal_id: null,
  lead_id: null,
  subject: 'help',
  body: 'the ticket body',
  status: 'open',
  priority: 'medium',
  category: 'general',
  assigned_to: null,
  sla_policy_id: null,
  first_response_at: null,
  portal_token: TOKEN,
  metadata: {},
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
  created_by: null,
  updated_by: null,
  deleted_by: null,
  deleted_at: null,
  resolved_at: null,
};

const REPLY_ROW: Record<string, unknown> = {
  id: 'rep1',
  ticket_id: 'tick1',
  tenant_id: TENANT,
  user_id: null,
  contact_id: 'c1',
  body: 'a reply',
  is_internal: false,
  metadata: {},
  created_at: '2026-10-07T00:00:00.000Z',
};

/**
 * `.returning()` → the whole row; `.returning({ key: column })` → exactly those
 * keys, read out of the row by the column's database name.
 */
function project(row: Record<string, unknown>, selection?: Record<string, { name: string }>) {
  if (!selection) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(selection)) out[key] = row[column.name];
  return out;
}

/**
 * One insert fake for both `db.insert()` and `tx.insert()`. #2446 moved these
 * writes inside a tenant (or credential) context, so the transaction handle has
 * to offer the same surface the bare `db` does — otherwise this file would be
 * reporting that the route asked for a connection, not that it echoed a
 * credential. It answers with the row of whichever table is being written (a
 * reply carries `ticketId`, a ticket carries `subject`), which is what the
 * `.returning()` projection assertions below depend on.
 */
function insertChain() {
  return {
    values: (v: Record<string, unknown>) => {
      valuesMock(v);
      const row = 'ticketId' in v ? REPLY_ROW : TICKET_ROW;
      return { returning: (...args: unknown[]) => returningMock(args[0], row) };
    },
  };
}

function selectChain() {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ id: 'tick1', status: 'open', contactId: 'c1', tenantId: TENANT }]),
      }),
    }),
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      contacts: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    },
    insert: vi.fn(() => insertChain()),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      execute: vi.fn().mockResolvedValue([]),
      query: {
        contacts: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
      },
      select: vi.fn(selectChain),
      insert: vi.fn(() => insertChain()),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    })),
    select: vi.fn(selectChain),
  },
}));

vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: () => mockIdentity.current,
  resolvePortalContact: () => mockContact.current,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));

function postJson(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIdentity.current = null;
  mockContact.current = null;
  findFirstMock.mockResolvedValue({ id: 'c1', tenantId: TENANT });
  // default: the database row comes back whole
  returningMock.mockImplementation((sel?: Record<string, { name: string }>, row: Record<string, unknown> = TICKET_ROW) =>
    Promise.resolve([project(row, sel)]));
});

describe('POST /api/public/tickets (#2440)', () => {
  const call = () => postJson('http://localhost/api/public/tickets', {
    email: 'a@b.com', subject: 'help', tenant_id: TENANT,
  });

  it('mints no credential at all — the column is not written any more (#2444)', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(call());
    expect(res.status).toBe(201);
    expect(valuesMock.mock.calls[0][0]).not.toHaveProperty('portalToken');
  });

  it('names the columns it returns instead of RETURNING *', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    await POST(call());
    const selection = returningMock.mock.calls[0][0];
    expect(typeof selection).toBe('object');
    expect(selection).not.toBeNull();
    const columnNames = Object.values(selection).map((c: { name: string }) => c.name);
    expect(columnNames).not.toContain('portal_token');
  });

  it('does not put the credential in the response body', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(call());
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('portal_token');
    expect(text).not.toContain('portalToken');
  });

  it('still answers the fields the portal needs to confirm the ticket', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(call());
    const body = await res.json();
    expect(body.data).toMatchObject({ id: 'tick1', subject: 'help', status: 'open' });
  });
});

describe('POST /api/public/tickets/[id]/replies (#2440, same class)', () => {
  it('returns the reply it wrote, not the whole row', async () => {
    mockIdentity.current = { email: 'a@b.com', tenantId: TENANT };
    mockContact.current = { id: 'c1', tenantId: TENANT };
    const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
    const res = await POST(
      postJson('http://localhost/api/public/tickets/tick1/replies', { body: 'a reply' }),
      { params: Promise.resolve({ id: 'tick1' }) },
    );
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(TENANT);
    expect(JSON.parse(text).data).toMatchObject({ id: 'rep1', body: 'a reply', isInternal: false });
  });
});
