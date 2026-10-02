/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the cleanup cron's split RLS contexts.
 *
 * The job touches four kinds of row that live under different policies
 * (ground truth from pre-prod pg_policies):
 *
 *   sessions / password_resets  — platform policies only (is_super_admin),
 *                                 NO tenant branch  → must run in a security ctx
 *   invitations                 — plain tenant_isolation, NO super branch
 *                                 → must run per tenant
 *   purge_trash() (contacts/deals/companies/tasks) — SECURITY INVOKER, so it
 *                                 deletes whatever the caller's context admits.
 *
 * These tests pin that split, pin the deliberate downgrade of
 * app.is_super_admin before the sweep (otherwise the dashboard-trigger path's
 * platform context would let ONE tenant iteration purge EVERY tenant's trash),
 * and pin the guard that only calls purge_trash() when >0 rows actually qualify.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type SqlFragment = { text: string; values: unknown[] };

const mockState = {
  eqCalls: [] as Array<{ column: unknown; value: unknown }>,
  /** lt(column, value) calls, to pin the retention predicate per table. */
  ltCalls: [] as Array<{ column: unknown; value: unknown }>,
  /** Every statement run on the bare db handle, in order. */
  dbExecutes: [] as SqlFragment[],
  /** Every statement run inside a withSecurityContext transaction. */
  txExecutes: [] as SqlFragment[],
  /** rowCount each successive security-context statement should report. */
  platformRowCounts: [] as number[],
  /** Qualifying trash rows per tenant, for the pre-purge count. */
  eligibleByTenant: new Map<string, number>(),
  purgeTrashCalls: [] as string[],
  /** Tables passed to db.delete(), in call order. */
  deletes: [] as string[],
  /** Deletes issued inside a security-context transaction (password resets). */
  txDeletes: [] as Array<{ table: string; rowCount: number }>,
  invitationsDeleted: 0,
  leadsPurged: 0,
  /** Simulates an FK referrer aborting the explicit leads purge. */
  leadsThrow: false,
  resetsDeleted: 0,
  activeTenant: null as string | null,
  txThrow: false,
};

async function defaultSweep(
  _context: string,
  body: (tenantId: string) => Promise<void>,
): Promise<CronTenantSweep> {
  const tenants = [TENANT_A, TENANT_B];
  for (const tenantId of tenants) {
    mockState.activeTenant = tenantId;
    await body(tenantId);
  }
  mockState.activeTenant = null;
  return { visited: tenants.length, skipped: [], failed: [] };
}

const mockSweepTenants = vi.fn(defaultSweep);

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: mockSweepTenants,
}));

const mockWithSecurityContext = vi.fn(
  async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: async (query: SqlFragment) => {
        mockState.txExecutes.push(query);
        const rowCount = mockState.platformRowCounts.shift() ?? 0;
        return { rows: [], rowCount };
      },
      delete: (table: unknown) => ({
        where: () => {
          const entry = {
            table: (table as { __table?: string }).__table ?? 'unknown',
            rowCount: mockState.resetsDeleted,
          };
          mockState.txDeletes.push(entry);
          return Promise.resolve({ rows: [], rowCount: mockState.resetsDeleted });
        },
      }),
    };
    return fn(tx);
  },
);

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: mockWithSecurityContext,
}));

vi.mock('drizzle-orm', () => {
  // Inline the two things these tests assert on: bare column-name strings and
  // table markers (`__table`). Everything else becomes a bound '?' parameter,
  // exactly like the real driver.
  const render = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && '__table' in v) return String((v as { __table: unknown }).__table);
    return null;
  };
  const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment => {
    const parts: string[] = [];
    const flat: unknown[] = [];
    for (let i = 0; i < strings.length; i++) {
      parts.push(strings[i] ?? '');
      if (i < values.length) {
        const v = values[i];
        const inlined = render(v);
        if (inlined !== null) {
          parts.push(inlined);
        } else if (v && typeof v === 'object' && 'text' in v && 'values' in v) {
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
    isNull: (column: unknown) => ({ __isNull: column }),
    lt: (column: unknown, value: unknown) => {
      mockState.ltCalls.push({ column, value });
      return { __lt: { column, value } };
    },
    sql: sqlTag,
  };
});

vi.mock('@/drizzle/schema', () => ({
  sessions: { __table: 'sessions', id: 'sessions.id', expiresAt: 'sessions.expires_at' },
  invitations: {
    __table: 'invitations',
    tenantId: 'invitations.tenant_id',
    expiresAt: 'invitations.expires_at',
    acceptedAt: 'invitations.accepted_at',
  },
  passwordResets: { __table: 'password_resets', expiresAt: 'password_resets.expires_at' },
  contacts: { __table: 'contacts', deletedAt: 'contacts.deleted_at' },
  deals: { __table: 'deals', deletedAt: 'deals.deleted_at' },
  companies: { __table: 'companies', deletedAt: 'companies.deleted_at' },
  tasks: { __table: 'tasks', deletedAt: 'tasks.deleted_at' },
  leads: { __table: 'leads', tenantId: 'leads.tenant_id', deletedAt: 'leads.deleted_at' },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: async (query: SqlFragment) => {
      mockState.dbExecutes.push(query);
      const text = query.text;
      if (text.includes('purge_trash')) {
        if (mockState.txThrow) throw new Error('violates foreign key constraint "activities_contact_id_fkey"');
        mockState.purgeTrashCalls.push(mockState.activeTenant ?? '?');
        // The real function returns the number of TABLES it ran (always 4),
        // never rows — the route must not treat it as a row count.
        return { rows: [{ count: 4 }], rowCount: 1 };
      }
      if (text.includes('count(*)')) {
        return {
          rows: [{ n: String(mockState.eligibleByTenant.get(mockState.activeTenant ?? '') ?? 0) }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    delete: (table: { __table?: string }) => ({
      where: () => {
        const name = String(table?.__table ?? '?');
        mockState.deletes.push(name);
        if (name === 'leads' && mockState.leadsThrow) {
          return Promise.reject(new Error('violates foreign key constraint "activities_lead_id_fkey"'));
        }
        return Promise.resolve({
          rows: [],
          rowCount: name === 'leads' ? mockState.leadsPurged : mockState.invitationsDeleted,
        });
      },
    }),
  },
}));

vi.mock('@/lib/crypto', () => ({ verifySecret: vi.fn(() => true) }));
vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn().mockResolvedValue({ acquired: true, value: 'lock-1' }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return { apiError: vi.fn(() => NextResponse.json({ error: 'internal' }, { status: 500 })) };
});
// The wrapper only pins a connection + times the request; the handler under test
// is the callback itself.
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: (fn: (request: NextRequest) => Promise<Response>) => fn,
}));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/auth/impersonation-reconcile', () => ({
  reconcileStaleImpersonations: vi.fn().mockResolvedValue({ reconciled: 0, failed: 0 }),
}));

function makeRequest(headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }): NextRequest {
  return new Request('http://localhost/api/cron/cleanup', { method: 'POST', headers }) as unknown as NextRequest;
}

function sqlText(query: SqlFragment | undefined): string {
  return (query?.text ?? '').replace(/\s+/g, ' ');
}

describe('cleanup cron — split platform / tenant RLS contexts', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockState.eqCalls.length = 0;
    mockState.ltCalls.length = 0;
    mockState.dbExecutes.length = 0;
    mockState.txExecutes.length = 0;
    mockState.platformRowCounts = [3, 0];
    mockState.eligibleByTenant = new Map([[TENANT_A, 0], [TENANT_B, 0]]);
    mockState.purgeTrashCalls.length = 0;
    mockState.deletes.length = 0;
    mockState.txDeletes.length = 0;
    mockState.invitationsDeleted = 0;
    mockState.leadsPurged = 0;
    mockState.leadsThrow = false;
    mockState.resetsDeleted = 1;
    mockState.activeTenant = null;
    mockState.txThrow = false;
    mockSweepTenants.mockImplementation(defaultSweep);
    // clearAllMocks() does not drop a mockReturnValue() set by an earlier test —
    // reset the auth seams explicitly so cases stay independent.
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValue(true);
    const { requireAuth } = await import('@/lib/auth/middleware');
    vi.mocked(requireAuth).mockReset();
  });

  it('accepts the cron secret without any auth context', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(vi.mocked(requireAuth)).not.toHaveBeenCalled();
  });

  it('accepts a manually triggered run from a logged-in super admin', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(200);
    expect(vi.mocked(requireAuth)).toHaveBeenCalled();
  });

  it('rejects a non-super-admin and an anonymous caller', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { verifySecret } = await import('@/lib/crypto');
    const { NextResponse } = await import('next/server');
    // No cron secret on the wire: the dashboard path is the only way in.
    vi.mocked(verifySecret).mockReturnValue(false);
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: false } as never);

    const { POST } = await import('@/app/api/cron/cleanup/route');
    expect((await POST(makeRequest({}))).status).toBe(401);

    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 401 }));
    expect((await POST(makeRequest({}))).status).toBe(401);
  });

  it('skips everything when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.skipped).toBe(true);
    expect(mockState.dbExecutes).toHaveLength(0);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('deletes expired sessions in bounded batches under the platform context', async () => {
    mockState.platformRowCounts = [1000, 250, 0];

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    const sessionStatements = mockState.txExecutes.filter((q) => sqlText(q).includes('DELETE FROM sessions'));
    expect(sessionStatements).toHaveLength(3);
    expect(sqlText(sessionStatements[0])).toContain('expires_at < NOW()');
    expect(sessionStatements[0]?.values).toContain(1000);
    expect(body.cleaned.sessions).toBe(1250);
  });

  it('clears expired password resets in the platform context too', async () => {
    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    // password_resets has no tenant_id branch, so it must NOT be swept per tenant.
    expect(mockState.txDeletes).toEqual([{ table: 'password_resets', rowCount: 1 }]);
    expect(body.cleaned.resets).toBe(1);
    expect(mockState.dbExecutes.some((q) => sqlText(q).includes('password_resets'))).toBe(false);
  });

  it('turns the platform privilege off before the tenant sweep', async () => {
    const { POST } = await import('@/app/api/cron/cleanup/route');
    await POST(makeRequest());

    const downgradeIndex = mockState.dbExecutes.findIndex((q) =>
      sqlText(q).includes("set_config('app.is_super_admin', 'false', false)"),
    );
    expect(downgradeIndex).toBeGreaterThanOrEqual(0);
    // Nothing destructive may reach the tenant tables while is_super_admin is
    // still set on this connection, so the downgrade must precede the sweep.
    const purgeIndex = mockState.dbExecutes.findIndex((q) => sqlText(q).includes('purge_trash'));
    expect(mockSweepTenants).toHaveBeenCalled();
    if (purgeIndex >= 0) expect(downgradeIndex).toBeLessThan(purgeIndex);
  });

  it('sweeps invitations per tenant with an explicit tenant filter', async () => {
    mockState.invitationsDeleted = 2;

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    expect(mockSweepTenants).toHaveBeenCalledWith('cron/cleanup', expect.any(Function));
    const tenantFilters = mockState.eqCalls.filter(
      (c) => c.column === 'invitations.tenant_id' && (c.value === TENANT_A || c.value === TENANT_B),
    );
    expect(tenantFilters.map((c) => c.value)).toEqual([TENANT_A, TENANT_B]);
    expect(body.cleaned.invitations).toBe(4);
  });

  it('never calls purge_trash for a tenant whose trash is all inside retention', async () => {
    mockState.eligibleByTenant = new Map([[TENANT_A, 0], [TENANT_B, 0]]);

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    expect(mockState.purgeTrashCalls).toHaveLength(0);
    expect(body.cleaned.trash_rows_deleted).toBe(0);
    expect(body.cleaned.trash_purge_runs).toBe(0);
    // The leads purge is the route's own statement, not part of purge_trash(),
    // so the retention skip above must not skip it too.
    expect(mockState.deletes.filter((t) => t === 'leads')).toHaveLength(2);
  });

  it('purges past-retention leads itself, one tenant at a time, with the same 30-day predicate', async () => {
    // public.purge_trash() covers contacts/deals/companies/tasks only, so
    // without this the trash UI kept listing leads forever.
    mockState.leadsPurged = 3;

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    expect(mockState.deletes.filter((t) => t === 'leads')).toHaveLength(2);
    const leadFilters = mockState.eqCalls.filter(
      (c) => c.column === 'leads.tenant_id' && (c.value === TENANT_A || c.value === TENANT_B),
    );
    expect(leadFilters.map((c) => c.value)).toEqual([TENANT_A, TENANT_B]);
    expect(body.cleaned.leads_purged).toBe(6);

    const leadLts = mockState.ltCalls.filter((c) => c.column === 'leads.deleted_at');
    expect(leadLts).toHaveLength(2);
    expect(sqlText(leadLts[0]!.value as SqlFragment)).toContain("NOW() - interval '30 days'");
  });

  it('keeps the leads purge non-fatal when an FK referrer blocks it', async () => {
    mockState.leadsThrow = true;
    const { logError } = await import('@/lib/errors-server');

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.ok).toBe(true);
    expect(body.cleaned.leads_purged).toBe(0);
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      expect.objectContaining({ context: `cron/cleanup purge-leads tenant=${TENANT_A}` }),
    );
  });

  it('purges only the tenants with >30-day trash and reports real row counts', async () => {
    mockState.eligibleByTenant = new Map([[TENANT_A, 7], [TENANT_B, 0]]);

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    // Exactly the tenant that qualified, and only once.
    expect(mockState.purgeTrashCalls).toEqual([TENANT_A]);
    expect(body.cleaned.trash_rows_deleted).toBe(7);
    expect(body.cleaned.trash_purge_runs).toBe(1);

    // The retention count mirrors the function's predicate: soft-deleted AND
    // older than 30 days, over all four trash tables.
    const countSql = sqlText(mockState.dbExecutes.find((q) => sqlText(q).includes('count(*)')));
    expect(countSql).toContain("NOW() - interval '30 days'");
    for (const table of ['contacts', 'deals', 'companies', 'tasks']) {
      expect(countSql).toContain(`FROM ${table}`);
      expect(countSql).toContain(`${table}.deleted_at IS NOT NULL`);
    }
  });

  it('keeps going when one tenant purge is blocked by an FK and still sweeps the rest', async () => {
    mockState.eligibleByTenant = new Map([[TENANT_A, 5], [TENANT_B, 5]]);
    mockState.txThrow = true;
    const { logError } = await import('@/lib/errors-server');

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    // Both tenants were attempted; neither aborted the sweep.
    expect(body.ok).toBe(true);
    expect(body.tenants_checked).toBe(2);
    // Nothing is reported as deleted when the destructive call failed.
    expect(body.cleaned.trash_rows_deleted).toBe(0);
    expect(body.cleaned.trash_purge_runs).toBe(0);
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      expect.objectContaining({ context: `cron/cleanup purge-trash tenant=${TENANT_A}` }),
    );
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      expect.objectContaining({ context: `cron/cleanup purge-trash tenant=${TENANT_B}` }),
    );
  });

  it('reports the sweep counters and flips ok when a tenant aborted', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [{ tenantId: TENANT_B, reason: 'no-acting-user' }],
      failed: [{ tenantId: TENANT_A, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/cleanup/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.ok).toBe(false);
    expect(body.tenants_checked).toBe(1);
    expect(body.tenants_skipped).toBe(1);
    expect(body.tenants_failed).toBe(1);
  });
});
