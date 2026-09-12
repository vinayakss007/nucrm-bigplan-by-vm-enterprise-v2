import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const findFirstMock = vi.fn();
const returningMock = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      contacts: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: (...args: unknown[]) => returningMock(...args) })),
    })),
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/public/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/public/tickets (#1982)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    returningMock.mockResolvedValue([]);
  });

  it('rejects requests without tenant_id', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(post({ email: 'a@b.com', subject: 'help' }));
    expect(res.status).toBe(400);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid tenant_id', async () => {
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(post({ email: 'a@b.com', subject: 'help', tenant_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when no contact matches in that tenant', async () => {
    findFirstMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(
      post({ email: 'a@b.com', subject: 'help', tenant_id: '11111111-1111-4111-8111-111111111111' })
    );
    expect(res.status).toBe(404);
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('creates the ticket under the matched tenant contact', async () => {
    findFirstMock.mockResolvedValue({ id: 'c1', tenantId: 't1' });
    returningMock.mockResolvedValue([{ id: 'tick1' }]);
    const { POST } = await import('@/app/api/public/tickets/route');
    const res = await POST(
      post({ email: 'a@b.com', subject: 'help', tenant_id: '11111111-1111-4111-8111-111111111111' })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: 'tick1' });
  });
});
