/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the process-sequences cron's per-tenant sweep (RLS tenant_isolation
 * has no super-admin branch — see lib/cron/tenant-scope.ts).
 *
 * '@/lib/cron/tenant-scope' is mocked so sweepTenants invokes the body once for
 * a fixed tenant id, and drizzle-orm's eq()/sql`` are instrumented so we can see
 * every tenant-scoped query carries an explicit tenant filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CRON_SECRET = 'test-secret';

type SqlFragment = { text: string; values: unknown[] };

const mockLock = { acquired: true, value: 'lock-1' };

const mockState = {
  eqCalls: [] as Array<{ column: unknown; value: unknown }>,
  executes: [] as SqlFragment[],
  findManyCalls: [] as unknown[],
  updates: [] as Array<{ set: Record<string, unknown> }>,
  txCount: 0,
  // Phase-1 fixtures (raw rows, as the DB returns them)
  dueRows: [] as unknown[],
  contactRows: [] as unknown[],
  steps: [] as unknown[],
  // Phase-2 fixtures
  recheckRows: [] as unknown[],
  nextDateRows: [] as unknown[],
};

async function defaultSweep(
  _context: string,
  body: (tenantId: string) => Promise<void>,
): Promise<CronTenantSweep> {
  await body(TENANT_A);
  return { visited: 1, skipped: [], failed: [] };
}

const mockSweepTenants = vi.fn(defaultSweep);

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: mockSweepTenants,
}));

vi.mock('drizzle-orm', () => {
  const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment => {
    const parts: string[] = [];
    const flat: unknown[] = [];
    for (let i = 0; i < strings.length; i++) {
      parts.push(strings[i] ?? '');
      if (i < values.length) {
        const v = values[i];
        if (v && typeof v === 'object' && 'text' in v && 'values' in v) {
          const frag = v as SqlFragment;
          parts.push(frag.text);
          flat.push(...frag.values);
        } else {
          parts.push('?');
          flat.push(v);
        }
      }
    }
    return { text: parts.join(''), values: flat };
  };
  return {
    eq: (column: unknown, value: unknown) => {
      mockState.eqCalls.push({ column, value });
      return { __eq: { column, value } };
    },
    and: (...args: unknown[]) => args.filter(Boolean),
    sql: Object.assign(sqlTag, {
      join: (fragments: SqlFragment[], sep: SqlFragment) => ({
        text: fragments.map(f => f.text).join(sep?.text ?? ','),
        values: fragments.flatMap(f => f.values),
      }),
    }),
  };
});

vi.mock('@/drizzle/schema', () => ({
  sequenceEnrollments: {
    id: 'sequence_enrollments.id',
    tenantId: 'sequence_enrollments.tenant_id',
    status: 'sequence_enrollments.status',
  },
  sequenceSteps: {
    id: 'sequence_steps.id',
    tenantId: 'sequence_steps.tenant_id',
    sequenceId: 'sequence_steps.sequence_id',
    stepNumber: 'sequence_steps.step_number',
    isActive: 'sequence_steps.is_active',
  },
  sequenceStepLogs: {
    enrollmentId: 'sequence_step_logs.enrollment_id',
    stepId: 'sequence_step_logs.step_id',
    status: 'sequence_step_logs.status',
    tenantId: 'sequence_step_logs.tenant_id',
  },
  tasks: { tenantId: 'tasks.tenant_id' },
}));

const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  mockState.txCount++;
  const txNumber = mockState.txCount;
  let executeCount = 0;
  const updateBuilder = {
    set: (values: Record<string, unknown>) => ({
      where: () => {
        mockState.updates.push({ set: values });
        return Promise.resolve();
      },
    }),
  };
  const tx = {
    execute: async (query: SqlFragment) => {
      executeCount++;
      mockState.executes.push(query);
      if (txNumber === 1) {
        // Phase 1: call 1 = due enrollments, call 2 = contacts.
        return { rows: executeCount === 1 ? mockState.dueRows : mockState.contactRows };
      }
      // Phase 2 (one tx per enrollment): call 1 = recheck, call 2 = next-step date.
      return { rows: executeCount === 1 ? mockState.recheckRows : mockState.nextDateRows };
    },
    query: {
      sequenceSteps: {
        findMany: async (opts: unknown) => {
          mockState.findManyCalls.push(opts);
          return mockState.steps;
        },
        findFirst: async () => null,
      },
    },
    update: () => updateBuilder,
    insert: () => ({ values: () => Promise.resolve() }),
  };
  return fn(tx);
});

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: mockTransaction,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          mockState.updates.push({ set: values });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock('@/lib/crypto', () => ({
  verifySecret: vi.fn(() => true),
}));

vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn().mockResolvedValue(mockLock),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    apiError: vi.fn(() => NextResponse.json({ error: 'internal' }, { status: 500 })),
  };
});

vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  createEmailTracking: vi.fn().mockResolvedValue(null),
  addTracking: vi.fn((html: string) => html),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeHTMLServer: vi.fn((s: string) => s),
}));

vi.mock('@/lib/email/unsubscribe-token', () => ({
  generateUnsubscribeToken: vi.fn(() => 'token'),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/process-sequences', {
    method: 'POST',
    headers: { 'x-cron-secret': CRON_SECRET },
  }) as unknown as NextRequest;
}

describe('process-sequences cron — per-tenant sweep', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockState.eqCalls.length = 0;
    mockState.executes.length = 0;
    mockState.findManyCalls.length = 0;
    mockState.updates.length = 0;
    mockState.txCount = 0;
    mockState.dueRows = [];
    mockState.contactRows = [];
    mockState.steps = [];
    mockState.recheckRows = [];
    mockState.nextDateRows = [];
    mockSweepTenants.mockImplementation(defaultSweep);
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValue(mockLock);
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const req = new Request('http://localhost/api/cron/process-sequences', {
      method: 'POST',
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('runs the job body once per tenant via sweepTenants', async () => {
    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSweepTenants).toHaveBeenCalledWith('cron/process-sequences', expect.any(Function));
    // The body ran under the sweep's tenant: the Phase-1 due-enrollments query
    // was executed and bound that tenant id.
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockState.executes[0]?.values).toContain(TENANT_A);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
    expect(body.tenants_checked).toBe(1);
    expect(body.tenants_skipped).toBe(0);
    expect(body.tenants_failed).toBe(0);
  });

  it('binds an explicit tenant filter to every tenant-scoped query in the pipeline', async () => {
    mockState.dueRows = [{
      id: 'e1',
      tenant_id: TENANT_A,
      sequence_id: 'seq1',
      contact_id: 'c1',
      current_step: 1,
      next_step_at: new Date(),
      status: 'active',
    }];
    mockState.contactRows = [{ id: 'c1', email: null, do_not_contact: false }];
    mockState.steps = [{
      id: 'step1',
      sequenceId: 'seq1',
      stepNumber: 1,
      stepType: 'email',
      subject: 'Follow up',
      body: 'Body',
      content: null,
    }];
    mockState.recheckRows = [{ id: 'e1', status: 'active', current_step: 1 }];
    mockState.nextDateRows = [];

    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1);

    // Raw SQL: due enrollments, contacts and the re-check all bind the tenant id.
    const [dueSql, contactsSql, recheckSql] = mockState.executes;
    expect(dueSql?.text).toContain('tenant_id');
    expect(dueSql?.values).toContain(TENANT_A);
    expect(contactsSql?.text).toContain('tenant_id');
    expect(contactsSql?.values).toContain(TENANT_A);
    expect(recheckSql?.text).toContain('tenant_id');
    expect(recheckSql?.values).toContain(TENANT_A);

    // Drizzle where clauses: steps lookup and both updates carry a tenant equality.
    const tenantEqs = mockState.eqCalls.filter(
      (c) => typeof c.column === 'string' && c.column.endsWith('.tenant_id') && c.value === TENANT_A,
    );
    const tables = tenantEqs.map((c) => String(c.column).split('.')[0]);
    expect(tables).toContain('sequence_steps');
    expect(tables).toContain('sequence_step_logs');
    expect(tables).toContain('sequence_enrollments');
  });

  it('reports tenant counts and flips ok when a tenant fails or is skipped', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [{ tenantId: TENANT_B, reason: 'no-acting-user' }],
      failed: [{ tenantId: TENANT_A, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.processed).toBe(0);
    expect(body.tenants_checked).toBe(1);
    expect(body.tenants_skipped).toBe(1);
    expect(body.tenants_failed).toBe(1);
  });

  it('skips the sweep entirely when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(true);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('releases the distributed lock after the sweep', async () => {
    const { releaseLock } = await import('@/lib/cache');
    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(vi.mocked(releaseLock)).toHaveBeenCalledWith('cron:process-sequences', 'lock-1');
  });
});
