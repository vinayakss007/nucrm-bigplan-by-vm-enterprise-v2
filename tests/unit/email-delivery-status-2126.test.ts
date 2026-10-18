/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2126 (item 4) — two routes told the caller an email had been sent when the
 * provider had refused it.
 *
 * `sendEmail` reports a rejected send as a returned `{ success: false }` and
 * does NOT throw (`lib/email/service.ts:249`, the #1041 work). Both callers
 * below read that contract wrong:
 *   - `app/api/auth/resend-verification` awaited it and discarded the answer,
 *     then returned `{ ok: true }` — and `components/tenant/email-verify-banner.tsx`
 *     turned any 200 into "Verification email sent!", so a user with no mail
 *     provider configured stared at a success toast and an inbox that stayed
 *     empty;
 *   - `app/api/tenant/invite/send` already had an `emailFailed` flag, but set it
 *     only in its `catch` — which a refused send never reaches.
 *
 * The invoice/offer senders (`app/api/tenant/invoices/[id]/send/route.ts:76`,
 * `app/api/tenant/offers/[quoteId]/send/route.ts:148`) already capture the
 * result, which is the shape these two are moved to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';

const mockSendEmail = vi.hoisted(() => vi.fn());

const mockDb = {
  update: vi.fn(),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'invitation-1', token: 'tok-abc' }])),
      })),
    })),
  })),
  query: {
    users: { findFirst: vi.fn(async () => ({ email: 'rep@example.test', fullName: 'Rep', emailVerified: false })) },
    tenantMembers: { findFirst: vi.fn(async () => undefined) },
    tenants: { findFirst: vi.fn(async () => ({ name: 'Acme', primaryColor: '#7c3aed' })) },
  },
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const step of ['from', 'innerJoin', 'where', 'orderBy']) chain[step] = () => chain;
    chain.limit = () => Promise.resolve([]);
    return chain;
  }),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/email/service', () => ({ sendEmail: mockSendEmail }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => ({
      userId: USER_A,
      tenantId: TENANT_A,
      roleSlug: 'owner',
      isAdmin: true,
      isSuperAdmin: false,
      permissions: {},
    })),
    can: vi.fn(() => true),
  };
});
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

function post(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(mod: { POST: (r: NextRequest) => Promise<Response> }, url: string, body: Record<string, unknown> = {}) {
  const res = await mod.POST(post(url, body));
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const resend = () => import('@/app/api/auth/resend-verification/route');
const invite = () => import('@/app/api/tenant/invite/send/route');

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue({ success: true, provider: 'resend', messageId: 'msg-1' });
});

describe('#2126 — POST /api/auth/resend-verification reports delivery, not just the row', () => {
  it('a provider rejection answers email_failed:true instead of a bare ok:true', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'RESEND_API_KEY not set' });
    const res = await call(await resend(), '/api/auth/resend-verification');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, email_failed: true });
  });

  it('a delivered send answers email_failed:false', async () => {
    const res = await call(await resend(), '/api/auth/resend-verification');
    expect(res.json).toEqual({ ok: true, email_failed: false });
  });

  it('still writes the verification row when the send fails — ok means the record', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'SMTP host refused' });
    const res = await call(await resend(), '/api/auth/resend-verification');
    expect(res.json?.ok).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

describe('#2126 — POST /api/tenant/invite/send takes delivery from the result, not the throw', () => {
  const body = { email: 'New@Example.test', roleSlug: 'sales_rep' };

  it('email_failed:true when sendEmail resolves a rejection (no exception thrown)', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'No email provider configured' });
    const res = await call(await invite(), '/api/tenant/invite/send', body);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, email_failed: true });
  });

  it('email_failed:false when the provider accepts it', async () => {
    const res = await call(await invite(), '/api/tenant/invite/send', body);
    expect(res.json).toEqual({ ok: true, email_failed: false });
  });

  it('the pre-existing catch path still reports email_failed:true', async () => {
    mockSendEmail.mockRejectedValue(new Error('socket hung up'));
    const res = await call(await invite(), '/api/tenant/invite/send', body);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, email_failed: true });
  });
});
