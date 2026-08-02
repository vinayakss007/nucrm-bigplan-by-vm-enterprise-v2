import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockReturning = vi.fn().mockResolvedValue([]);
const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
const mockTxUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
const mockTxInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockTransaction = vi.fn(async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
  const tx = { update: mockTxUpdate, insert: mockTxInsert };
  return cb(tx);
});
const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockDbUpdateReturning = vi.fn().mockResolvedValue([]);
const mockDbUpdateWhere = vi.fn().mockReturnValue({ returning: mockDbUpdateReturning });
const mockDbUpdateSet = vi.fn().mockReturnValue({ where: mockDbUpdateWhere });
const mockInsertValues = vi.fn().mockResolvedValue(undefined);

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: mockTransaction,
    insert: vi.fn().mockReturnValue({
      values: mockInsertValues,
    }),
    select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
    update: vi.fn().mockReturnValue({ set: mockDbUpdateSet }),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  contacts: {
    email: 'email',
    doNotContact: 'do_not_contact',
    deletedAt: 'deleted_at',
    id: 'id',
    tenantId: 'tenant_id',
    firstName: 'first_name',
    metadata: 'metadata',
    updatedAt: 'updated_at',
  },
  sequenceEnrollments: {
    contactId: 'contact_id',
    status: 'status',
    updatedAt: 'updated_at',
  },
  activities: {
    id: 'id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
  isNull: vi.fn(() => true),
  inArray: vi.fn(() => true),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => `SQL(${values.join(',')})`),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>): NextRequest {
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('resend webhook DNC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  describe('hard bounce', () => {
    it('sets doNotContact and cancels enrollments atomically', async () => {
      mockReturning.mockResolvedValue([{ id: 'c1', tenantId: 't1', firstName: 'A' }]);

      const { POST } = await import('@/app/api/webhooks/resend/route');
      const req = makeRequest({
        type: 'email.bounced',
        data: { to: ['test@example.com'], bounce_type: 'hard', created_at: new Date().toISOString() },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      // Transaction was called (atomic DNC + enrollment cancel)
      expect(mockTransaction).toHaveBeenCalled();

      // Transaction should have updated contacts with doNotContact=true
      expect(mockTxUpdate).toHaveBeenCalled();
    });

    it('activity insert runs AFTER transaction and is non-fatal', async () => {
      mockReturning.mockResolvedValue([{ id: 'c1', tenantId: 't1', firstName: 'A' }]);

      // Make the db.insert (activity) fail
      const { db } = await import('@/drizzle/db');
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('NOT NULL constraint on event_type')),
      } as ReturnType<typeof db.insert>);

      const { POST } = await import('@/app/api/webhooks/resend/route');
      const req = makeRequest({
        type: 'email.bounced',
        data: { to: ['test@example.com'], bounce_type: 'hard', created_at: new Date().toISOString() },
      });

      // Should NOT throw — activity failure is non-fatal
      const res = await POST(req);
      expect(res.status).toBe(200);

      // Transaction still committed (DNC flag persisted)
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('complaint', () => {
    it('treats complaints like hard bounces — immediate DNC', async () => {
      mockReturning.mockResolvedValue([{ id: 'c2', tenantId: 't2', firstName: 'B' }]);

      const { POST } = await import('@/app/api/webhooks/resend/route');
      const req = makeRequest({
        type: 'email.complained',
        data: { to: ['user@test.com'], created_at: new Date().toISOString() },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('webhook secret', () => {
    it('rejects requests with invalid secret', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'my-secret';

      const { POST } = await import('@/app/api/webhooks/resend/route');
      const req = makeRequest(
        { type: 'email.bounced', data: { to: ['a@b.com'], created_at: new Date().toISOString() } },
        { 'x-webhook-secret': 'wrong' }
      );

      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  describe('email.replied', () => {
    beforeEach(() => {
      mockSelectLimit.mockResolvedValue([]);
      mockDbUpdateReturning.mockResolvedValue([]);
      mockUpdateSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
    });

    it('cancels active sequence enrollments when a contact replies', async () => {
      mockSelectLimit.mockResolvedValue([{ id: 'c3', tenantId: 't3' }]);
      mockDbUpdateReturning.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);

      const { POST } = await import('@/app/api/webhooks/resend/route');
      const req = makeRequest({
        type: 'email.replied',
        data: { to: ['replier@test.com'], created_at: new Date().toISOString() },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockSelectFrom).toHaveBeenCalled();
      expect(mockDbUpdateSet).toHaveBeenCalled();
      expect(mockDbUpdateReturning).toHaveBeenCalled();
    });

    it('does NOT mark a replier as doNotContact', async () => {
      mockSelectLimit.mockResolvedValue([{ id: 'c4', tenantId: 't4' }]);
      mockDbUpdateReturning.mockResolvedValue([]);

      const { POST } = await import('@/app/api/webhooks/resend/route');
      const req = makeRequest({
        type: 'email.replied',
        data: { to: ['engaged@test.com'], created_at: new Date().toISOString() },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe('unknown event types', () => {
    it('returns 200 for unrecognized events', async () => {
      const { POST } = await import('@/app/api/webhooks/resend/route');
      const req = makeRequest({
        type: 'email.opened',
        data: { to: ['a@b.com'], created_at: new Date().toISOString() },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });
});
