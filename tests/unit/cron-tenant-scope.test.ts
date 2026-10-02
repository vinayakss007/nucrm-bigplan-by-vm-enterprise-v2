/**
 * Tests for lib/cron/tenant-scope.ts — the per-tenant sweep that scheduled
 * jobs use because tenant tables enforce plain `tenant_isolation` with no
 * super-admin branch (see the module's header comment).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTxExecute = vi.fn();
const mockDbExecute = vi.fn();
const mockSetTenantContext = vi.fn();
const mockClearTenantContext = vi.fn();
const mockLogError = vi.fn();
let pinnedScopes = 0;

vi.mock('@/drizzle/db', () => ({
  db: { execute: (node: unknown) => mockDbExecute(node) },
}));

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: (fn: (tx: { execute: typeof mockTxExecute }) => Promise<unknown>) =>
    fn({ execute: mockTxExecute }),
  setTenantContext: async (tenantId: string, userId: string) => { await mockSetTenantContext(tenantId, userId); },
  clearTenantContext: async () => { await mockClearTenantContext(); },
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: async (fn: () => Promise<unknown>) => {
    pinnedScopes++;
    return fn();
  },
}));

vi.mock('@/lib/errors-server', () => ({
  logError: (arg: unknown) => mockLogError(arg),
}));

/**
 * Render a drizzle `sql` template into the text it will send, so the
 * enumeration's guard rails can be asserted without a live connection.
 */
function sqlText(node: unknown): string {
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((chunk) => (typeof chunk === 'string'
      ? chunk
      : String((chunk as { value?: unknown } | null)?.value ?? '')))
    .join('');
}

describe('cron tenant sweep', () => {
  beforeEach(() => {
    vi.resetModules();
    mockTxExecute.mockReset();
    mockDbExecute.mockReset();
    mockSetTenantContext.mockReset();
    mockClearTenantContext.mockReset();
    mockLogError.mockReset();
    pinnedScopes = 0;
    // No active member found by default, so the sweep keeps the enumerated
    // identity and the pre-existing call-count assertions stay meaningful.
    mockDbExecute.mockResolvedValue({ rows: [] });
  });

  it('lists active tenants with an acting user and reports the rest as skipped', async () => {
    mockTxExecute.mockResolvedValue({
      rows: [
        { tenant_id: 't-1', user_id: 'u-1' },
        { tenant_id: 't-2', user_id: 'u-2' },
        { tenant_id: 't-3', user_id: null },
      ],
    });

    const { listSweepableTenants } = await import('@/lib/cron/tenant-scope');
    const { tenants, skipped } = await listSweepableTenants();

    expect(tenants).toEqual([
      { tenantId: 't-1', userId: 'u-1' },
      { tenantId: 't-2', userId: 'u-2' },
    ]);
    expect(skipped).toEqual([{ tenantId: 't-3', reason: 'no-acting-user' }]);
  });

  it('enumerates non-suspended tenants and resolves an acting user per tenant', async () => {
    mockTxExecute.mockResolvedValue({ rows: [] });
    const { listSweepableTenants } = await import('@/lib/cron/tenant-scope');
    await listSweepableTenants();

    const text = sqlText(mockTxExecute.mock.calls[0]![0]);
    expect(text).toMatch(/status <> 'suspended'/);
    // The acting identity must come from a readable source: tenant_members is
    // itself RLS-blind here, so it is owner_id with users.last_tenant_id as the
    // fallback — never a membership lookup.
    expect(text).toMatch(/COALESCE/);
    expect(text).toMatch(/last_tenant_id/);
    expect(text).not.toMatch(/tenant_members/);
  });

  it('runs the body once per tenant, each under that tenant\'s own context', async () => {
    mockTxExecute.mockResolvedValue({
      rows: [
        { tenant_id: 't-1', user_id: 'u-1' },
        { tenant_id: 't-2', user_id: 'u-2' },
      ],
    });
    const seen: string[] = [];

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    const sweep = await sweepTenants('cron/example', async (tenantId) => {
      // The context must already be set for THIS tenant when the body runs.
      expect(mockSetTenantContext).toHaveBeenLastCalledWith(tenantId, `u-${tenantId.slice(2)}`);
      seen.push(tenantId);
    });

    expect(seen).toEqual(['t-1', 't-2']);
    expect(sweep).toEqual({ visited: 2, skipped: [], failed: [] });
    // One connection for the whole sweep, so session-scoped GUCs stay visible
    // to the helper calls the bodies make.
    expect(pinnedScopes).toBe(1);
  });

  it('clears the tenant context between tenants so it cannot leak', async () => {
    mockTxExecute.mockResolvedValue({
      rows: [
        { tenant_id: 't-1', user_id: 'u-1' },
        { tenant_id: 't-2', user_id: 'u-2' },
      ],
    });

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    await sweepTenants('cron/example', async () => undefined);

    expect(mockClearTenantContext).toHaveBeenCalledTimes(2);
    expect(mockSetTenantContext.mock.calls[0]![0]).toBe('t-1');
    expect(mockSetTenantContext.mock.calls[1]![0]).toBe('t-2');
  });

  it('keeps sweeping after one tenant throws and reports the failure', async () => {
    mockTxExecute.mockResolvedValue({
      rows: [
        { tenant_id: 't-1', user_id: 'u-1' },
        { tenant_id: 't-2', user_id: 'u-2' },
        { tenant_id: 't-3', user_id: 'u-3' },
      ],
    });
    const seen: string[] = [];

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    const sweep = await sweepTenants('cron/example', async (tenantId) => {
      seen.push(tenantId);
      if (tenantId === 't-2') throw new Error('boom');
    });

    expect(seen).toEqual(['t-1', 't-2', 't-3']);
    expect(sweep.visited).toBe(2);
    expect(sweep.failed).toEqual([{ tenantId: 't-2', error: 'boom' }]);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'cron/example tenant=t-2' })
    );
  });

  it('never runs the body for a tenant with no acting user', async () => {
    mockTxExecute.mockResolvedValue({
      rows: [{ tenant_id: 't-1', user_id: 'u-1' }, { tenant_id: 't-orphan', user_id: null }],
    });
    const seen: string[] = [];

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    const sweep = await sweepTenants('cron/example', async (tenantId) => {
      seen.push(tenantId);
    });

    expect(seen).toEqual(['t-1']);
    expect(sweep.visited).toBe(1);
    expect(sweep.skipped).toEqual([{ tenantId: 't-orphan', reason: 'no-acting-user' }]);
  });

  it('survives a failing context clear without losing the sweep result', async () => {
    mockTxExecute.mockResolvedValue({ rows: [{ tenant_id: 't-1', user_id: 'u-1' }] });
    mockClearTenantContext.mockRejectedValue(new Error('client tearing down'));

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    const sweep = await sweepTenants('cron/example', async () => undefined);

    expect(sweep).toEqual({ visited: 1, skipped: [], failed: [] });
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'cron/example clear-tenant-context' })
    );
  });

  it('acts as an active member when the enumerated user is not one', async () => {
    // users is guarded by users_tenant_member_read, which only admits a reader
    // whose app.current_user is an ACTIVE tenant_members row — so a job that
    // joins users/tenant_members reads zero rows when the guessed identity is
    // not a member, and would notify nobody.
    mockTxExecute.mockResolvedValue({ rows: [{ tenant_id: 't-1', user_id: 'u-guess' }] });
    mockDbExecute.mockResolvedValue({ rows: [{ user_id: 'u-member' }] });

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    const sweep = await sweepTenants('cron/example', async () => undefined);

    expect(sweep).toEqual({ visited: 1, skipped: [], failed: [] });
    expect(mockSetTenantContext.mock.calls).toEqual([
      ['t-1', 'u-guess'],
      ['t-1', 'u-member'],
    ]);
  });

  it('queries membership only for active rows and prefers the guessed identity', async () => {
    mockTxExecute.mockResolvedValue({ rows: [{ tenant_id: 't-1', user_id: 'u-guess' }] });

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    await sweepTenants('cron/example', async () => undefined);

    const text = sqlText(mockDbExecute.mock.calls[0]![0]);
    expect(text).toMatch(/FROM tenant_members/);
    expect(text).toMatch(/status = 'active'/);
    expect(text).toMatch(/ORDER BY \(user_id = /);
    expect(text).toMatch(/LIMIT 1/);
  });

  it('still runs the body when the membership lookup fails, logging the guess', async () => {
    mockTxExecute.mockResolvedValue({ rows: [{ tenant_id: 't-1', user_id: 'u-guess' }] });
    mockDbExecute.mockRejectedValue(new Error('permission denied for tenant_members'));
    const seen: string[] = [];

    const { sweepTenants } = await import('@/lib/cron/tenant-scope');
    const sweep = await sweepTenants('cron/example', async (tenantId) => { seen.push(tenantId); });

    expect(seen).toEqual(['t-1']);
    expect(sweep).toEqual({ visited: 1, skipped: [], failed: [] });
    expect(mockSetTenantContext.mock.calls).toEqual([['t-1', 'u-guess']]);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'cron/example resolve-member tenant=t-1' })
    );
  });
});
