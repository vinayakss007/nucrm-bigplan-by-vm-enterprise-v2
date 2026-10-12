/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// #2383: /api/public/csat/[token] was the only unauthenticated public route
// with no throttle — the survey token is its only credential, so the rate
// limiter is the sole per-IP control. These tests pin that BOTH handlers are
// gated, that they use SEPARATE buckets (a page reload must not consume the
// right to answer), and that a throttled request never reaches the database.

const mockRateLimit = vi.fn();
let selectCalls = 0;

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => {
      selectCalls++;
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve([]),
        then: (res: (v: unknown) => unknown) => Promise.resolve([]).then(res),
      };
      return chain;
    }),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve([]) }) })),
  },
}));

function req(method: 'GET' | 'POST', token = 'a'.repeat(48)) {
  return new Request(`http://localhost/api/public/csat/${token}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({ score: 5, comment: 'great' }) : undefined,
  }) as unknown as NextRequest;
}

function params(token = 'a'.repeat(48)) {
  return { params: Promise.resolve({ token }) };
}

const TOO_MANY = new NextResponse(JSON.stringify({ error: 'Too many requests' }), {
  status: 429,
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  vi.clearAllMocks();
  selectCalls = 0;
  mockRateLimit.mockResolvedValue(null);
});

describe('GET /api/public/csat/[token] rate limit (#2383)', () => {
  it('is gated before any database work', async () => {
    const { GET } = await import('@/app/api/public/csat/[token]/route');
    const res = await GET(req('GET'), params());
    expect(res.status).toBe(404); // unknown survey, but only after the gate
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    const [request, options] = mockRateLimit.mock.calls[0] as [{ action?: string }, Record<string, unknown>];
    expect((options as { action: string }).action).toBe('public-csat-view');
    expect(typeof (options as { max: number }).max).toBe('number');
    expect(request).toBeTruthy();
  });

  it('returns the limiter response untouched and never queries when throttled', async () => {
    mockRateLimit.mockResolvedValue(TOO_MANY);
    const { GET } = await import('@/app/api/public/csat/[token]/route');
    const res = await GET(req('GET'), params());
    expect(res.status).toBe(429);
    expect(selectCalls).toBe(0);
  });
});

describe('POST /api/public/csat/[token] rate limit (#2383)', () => {
  it('is gated with its own bucket, separate from the view limit', async () => {
    const { POST } = await import('@/app/api/public/csat/[token]/route');
    const res = await POST(req('POST'), params());
    expect(res.status).toBe(404);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    const action = (mockRateLimit.mock.calls[0] as [unknown, { action: string }])[1].action;
    expect(action).toBe('public-csat-respond');
    expect(action).not.toBe('public-csat-view');
  });

  it('never reaches the survey read or update when throttled', async () => {
    mockRateLimit.mockResolvedValue(TOO_MANY);
    const { POST } = await import('@/app/api/public/csat/[token]/route');
    const res = await POST(req('POST'), params());
    expect(res.status).toBe(429);
    expect(selectCalls).toBe(0);
    const { db } = await import('@/drizzle/db');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('validates the score before spending the rate-limit budget matters', async () => {
    // score is validated after the gate, so a flood of garbage still costs DB
    // reads — assert the order is gate → validation, not the reverse.
    const { POST } = await import('@/app/api/public/csat/[token]/route');
    const bad = new Request('http://localhost/api/public/csat/' + 'a'.repeat(48), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: 99 }),
    }) as unknown as NextRequest;
    const res = await POST(bad, params());
    expect(res.status).toBe(400);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(selectCalls).toBe(0);
  });
});
