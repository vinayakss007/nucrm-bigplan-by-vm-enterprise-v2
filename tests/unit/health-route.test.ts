/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1972 — /api/health must serve a cached, time-bounded readiness probe
 * (deploy gates poll it every few seconds against a WAN DB), and
 * /api/health/live must answer instantly without touching dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const executeMock = vi.fn();
vi.mock('@/drizzle/db', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { execute: (...args: any[]) => executeMock(...args) },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(params: Record<string, string> = {}): any {
  return { nextUrl: { searchParams: new URLSearchParams(params) } };
}

async function loadHealth() {
  const mod = await import('@/app/api/health/route');
  return mod.GET;
}

describe('GET /api/health — cached readiness probe (#1972)', () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
  });

  it('returns 200 with the unchanged wire format when the schema probe succeeds', async () => {
    executeMock.mockResolvedValue({ rowCount: 1 });
    const GET = await loadHealth();
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', db: 'connected', schema_ready: true, service: 'nucrm-app' });
  });

  it('caches the probe so repeated polling hits the DB once', async () => {
    executeMock.mockResolvedValue({ rowCount: 5 });
    const GET = await loadHealth();
    const a = await GET(makeReq());
    const b = await GET(makeReq());
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent probes into a single DB query', async () => {
    let release: (v: { rowCount: number }) => void;
    executeMock.mockReturnValue(new Promise<{ rowCount: number }>(res => { release = res; }));
    const GET = await loadHealth();
    const p1 = GET(makeReq());
    const p2 = GET(makeReq());
    release!({ rowCount: 2 });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('returns 503 quickly when the probe hangs past the timeout ceiling', async () => {
    vi.useFakeTimers();
    executeMock.mockReturnValue(new Promise(() => { /* never resolves */ }));
    const GET = await loadHealth();
    const p = GET(makeReq());
    await vi.advanceTimersByTimeAsync(3_100);
    const res = await p;
    vi.useRealTimers();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'error', db: 'error', schema_ready: false });
  });

  it('returns 503 when the probe throws', async () => {
    executeMock.mockRejectedValue(new Error('connection refused'));
    const GET = await loadHealth();
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'error', db: 'error' });
  });
});

describe('GET /api/health/live — instant liveness (#1972)', () => {
  afterEach(() => vi.resetModules());

  it('answers 200 with status alive and no dependencies', async () => {
    vi.resetModules();
    const { GET } = await import('@/app/api/health/live/route');
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'alive', service: 'nucrm-app' });
    expect(body.timestamp).toBeTruthy();
    expect(executeMock).not.toHaveBeenCalled();
  });
});
