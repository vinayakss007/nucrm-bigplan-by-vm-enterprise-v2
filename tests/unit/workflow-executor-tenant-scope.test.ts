/**
 * Regression test for the cross-tenant IDOR fix (audit C-2).
 *
 * executeWorkflow() receives contactId/dealId straight from the caller
 * (app/api/tenant/workflows/[id]/run passes request-body trigger_entity_id).
 * If those loads aren't scoped by tenantId, a user in tenant A can hydrate a
 * tenant B contact/deal into the workflow ctx and exfiltrate it via the
 * send_email / fire_webhook actions.
 *
 * We spy on drizzle-orm's `eq` so we can see exactly which (column, value)
 * pairs the executor filters on, then assert that BOTH the contact load and
 * the deal load include an equality against their table's `tenant_id` column
 * bound to the caller's tenantId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track every eq(column, value) call as { table, column, value }.
interface EqCall { table?: string; column?: string; value: unknown; }
const eqCalls: EqCall[] = [];

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: unknown, value: unknown) => {
      const c = col as { name?: string; table?: unknown };
      // Drizzle PgColumn exposes `.name` (db column) and a table ref with a name symbol.
      let table: string | undefined;
      try {
        const t = c?.table as Record<symbol, unknown> | undefined;
        if (t) {
          const nameSym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes('Name'));
          if (nameSym) table = String(t[nameSym]);
        }
      } catch { /* ignore */ }
      eqCalls.push({ table, column: c?.name, value });
      return actual.eq(col as never, value as never);
    },
  };
});

vi.mock('@/drizzle/db', () => {
  const builder = {
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(selectResults.shift() ?? []) }),
    }),
  };
  return {
    db: {
      select: () => builder,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'exec-1' }]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'log-1' }]) }) }),
          update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        }),
    },
  };
});

vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/capture-error', () => ({ captureError: vi.fn() }));

let selectResults: unknown[][] = [];

describe('executeWorkflow — tenant-scoped entity hydration (C-2)', () => {
  beforeEach(() => {
    eqCalls.length = 0;
  });

  it('filters the contact and deal loads by their tenant_id column', async () => {
    const TENANT = 'tenant-A';
    selectResults = [
      [{ id: 'wf-1', tenantId: TENANT, name: 'WF', nodes: [], edges: [], status: 'active' }],
      [], // contact load result (empty — cross-tenant id must not resolve)
      [], // deal load result
    ];

    const { executeWorkflow } = await import('@/lib/automation/workflow-executor');

    await executeWorkflow({
      tenantId: TENANT,
      workflowId: 'wf-1',
      contactId: 'contact-from-another-tenant',
      dealId: 'deal-from-another-tenant',
    });

    const tenantIdEqs = eqCalls.filter(
      (c) => c.column === 'tenant_id' && c.value === TENANT,
    );
    const tables = tenantIdEqs.map((c) => c.table);

    // Both the contacts and the deals load must be tenant-scoped.
    expect(tables).toContain('contacts');
    expect(tables).toContain('deals');
  });
});
