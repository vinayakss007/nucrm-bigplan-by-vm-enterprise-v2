/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3409 item 3 — the nightly `reconcile_counters` backstop.
 *
 * #3452 made every contact-insert door pay for its row in the same transaction,
 * but `tenants.current_contacts` is still a copy of
 * `COUNT(contacts WHERE deleted_at IS NULL)`. A missed path, a restore, or a
 * failed partial write leaves the plan gate priced against a stale number. This
 * job recomputes the truth and corrects the copy in one statement.
 *
 * The assertions below pin the three properties the job cannot lose:
 *  - the derived count excludes tombstones and includes tenants with zero live
 *    contacts (the LEFT JOIN), so a delete-everything tenant is reconciled too;
 *  - the correction and the drift evidence are the same statement, so a row
 *    cannot be corrected without being reported;
 *  - the platform context is what makes the cross-tenant read legal, and the
 *    job still verifies the cron secret and takes its dedup lock first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobByName } from '@/lib/cron/jobs';

const mockExecute = vi.fn();
const mockVerifyCronSecret = vi.fn(async () => true);
const mockRefuseLock = vi.fn(async (): Promise<Response | null> => null);
const mockLogError = vi.fn(async () => undefined);
const mockApiError = vi.fn(() => NextResponse.json({ error: 'Internal error' }, { status: 500 }));

vi.mock('@/lib/auth/cron', () => ({
  verifyCronSecret: (...args: unknown[]) => mockVerifyCronSecret(...args),
}));

vi.mock('@/lib/cron/cron-lock', () => ({
  refuseIfCronLockHeld: (...args: unknown[]) => mockRefuseLock(...args),
  instrumentCronRun: (_name: string, handler: unknown) => handler,
}));

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: (fn: (tx: { execute: typeof mockExecute }) => Promise<unknown>) =>
    fn({ execute: mockExecute }),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock('@/lib/api-error', () => ({
  apiError: (...args: unknown[]) => mockApiError(...args),
}));

const route = await import('@/app/api/cron/reconcile-counters/route');
const dialect = new PgDialect({} as never);

function sqlText(node: unknown): string {
  return dialect.sqlToQuery(node as never).sql;
}

function request(): NextRequest {
  return new NextRequest('http://localhost/api/cron/reconcile-counters', { method: 'POST' });
}

async function call() {
  const res = await (route.POST as (r: NextRequest) => Promise<Response>)(request());
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCronSecret.mockResolvedValue(true);
  mockRefuseLock.mockResolvedValue(null);
  mockExecute.mockResolvedValue({ rows: [] });
  mockApiError.mockReturnValue(NextResponse.json({ error: 'Internal error' }, { status: 500 }));
});

describe('POST /api/cron/reconcile-counters (#3409)', () => {
  it('recomputes live contacts, including tenants with zero live rows', async () => {
    await call();

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const text = sqlText(mockExecute.mock.calls[0]![0]);
    expect(text).toMatch(/WITH live AS/i);
    expect(text).toMatch(/FROM contacts/i);
    expect(text).toMatch(/deleted_at IS NULL/i);
    expect(text).toMatch(/COUNT\(\*\)::int/i);
    expect(text).toMatch(/LEFT JOIN live/i);
    expect(text).toMatch(/COALESCE\(t\.current_contacts, 0\)/i);
    expect(text).toMatch(/UPDATE tenants/i);
    expect(text).toMatch(/SET current_contacts = d\.actual/i);
    expect(text).toMatch(/RETURNING t\.id AS tenant_id, d\.stored, d\.actual/i);
  });

  it('corrects only the drifting rows and reports the old/new pair', async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { tenant_id: 't-1', stored: 3, actual: 4 },
        { tenant_id: 't-2', stored: 7, actual: 0 },
      ],
    });

    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      drifted: 2,
      corrected: 2,
      drift: [
        { tenant_id: 't-1', stored: 3, actual: 4 },
        { tenant_id: 't-2', stored: 7, actual: 0 },
      ],
    });
    expect(mockLogError).toHaveBeenCalledWith(expect.objectContaining({
      context: 'cron/reconcile-counters',
      level: 'warning',
      captureToSentry: false,
      metadata: expect.objectContaining({
        drifted: 2,
        tenants: [
          { tenant_id: 't-1', stored: 3, actual: 4 },
          { tenant_id: 't-2', stored: 7, actual: 0 },
        ],
      }),
    }));
  });

  it('is quiet when the copy already agrees with the rows', async () => {
    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, drifted: 0, corrected: 0, drift: [] });
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('verifies the cron secret before reading or locking anything', async () => {
    mockVerifyCronSecret.mockResolvedValue(false);

    const { status } = await call();

    expect(status).toBe(401);
    expect(mockRefuseLock).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns the lock refusal unchanged instead of reporting a run', async () => {
    mockRefuseLock.mockResolvedValue(
      NextResponse.json({ ok: false, skipped: 'lock-held' }, { status: 423 }),
    );

    const { status, body } = await call();

    expect(status).toBe(423);
    expect(body).toMatchObject({ ok: false, skipped: 'lock-held' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('logs the failure and answers through apiError when the reconciliation throws', async () => {
    mockExecute.mockRejectedValue(new Error('connection reset'));

    const { status } = await call();

    expect(status).toBe(500);
    expect(mockApiError).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(expect.objectContaining({
      context: 'cron/reconcile-counters',
    }));
  });

  it('is declared in the cron manifest as a daily job on every scheduler', () => {
    const job = jobByName('reconcile-counters');
    expect(job).toBeDefined();
    expect(job).toMatchObject({
      path: '/api/cron/reconcile-counters',
      cron: '15 3 * * *',
      owner: 'platform',
      expectedEveryMs: 24 * 60 * 60 * 1000,
      sources: { crontab: true, vercel: true, scheduler: true },
    });
    expect(existsSync(join(process.cwd(), 'app/api/cron/reconcile-counters/route.ts'))).toBe(true);
  });
});
