/**
 * #3107 — the deal-won auto-invoice helper wrapped its timeline-activity insert
 * in a try/catch INSIDE db.transaction. In Postgres a failed statement aborts
 * the transaction; the callback then returning normally turns the COMMIT into a
 * ROLLBACK, so the invoice (and its line items) is discarded while the function
 * still returns the invoice id and writes a success audit entry. The twin fix
 * in #2222 (convert-to-invoice) removed this exact trap at two other sites;
 * this test pins that the activity write now happens strictly after commit and
 * can never abort the invoice transaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  order: [] as string[],
  txTables: [] as string[],
  // #3405: each withTenantDb call opens its own transaction, so track the
  // tables per transaction rather than one flat list.
  txBatches: [] as string[][],
  currentBatch: [] as string[],
  activityFails: false,
}));

function tableName(table: { [Symbol.for('drizzle:Name')]?: string }): string {
  return table[Symbol.for('drizzle:Name')] ?? 'unknown';
}

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      invoices: { findFirst: async () => null },
      quotes: { findFirst: async () => null },
    },
    select: () => ({
      from: (table: { [Symbol.for('drizzle:Name')]?: string }) => ({
        where: () => ({
          limit: async () =>
            tableName(table) === 'tenants' ? [{ settings: { autoInvoiceOnWon: true } }] : [],
        }),
      }),
    }),
    insert: (table: { [Symbol.for('drizzle:Name')]?: string }) => ({
      values: async () => {
        const name = tableName(table);
        if (name === 'activities') {
          H.order.push('activity');
          if (H.activityFails) throw new Error('simulated FK/RLS failure on activity');
        }
        return [{ id: 1 }];
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      H.order.push('tx:start');
      H.currentBatch = [];
      const tx = {
        execute: async () => undefined,
        // #3405: the source reads now run on this branded client too.
        query: {
          invoices: { findFirst: async () => null },
          quotes: { findFirst: async () => null },
        },
        // #3405: both the settings read and the invoice-number read now run
        // through this handle; one chain must answer both shapes.
        select: () => ({
          from: (table: { [Symbol.for('drizzle:Name')]?: string }) => {
            const rows: unknown[] = [{ maxNum: 0 }];
            Object.assign(rows, {
              limit: async () => tableName(table) === 'tenants'
                ? [{ settings: { autoInvoiceOnWon: true } }]
                : rows,
            });
            return { where: () => rows };
          },
        }),
        insert: (table: { [Symbol.for('drizzle:Name')]?: string }) => {
          const name = tableName(table);
          H.txTables.push(name);
          H.currentBatch.push(name);
          if (name === 'activities') {
            H.order.push('activity');
            if (H.activityFails) throw new Error('simulated FK/RLS failure on activity');
          }
          return {
            values: (rows: unknown) => ({
              returning: async () =>
                name === 'invoices'
                  ? [{ id: 'inv-1', ...(Array.isArray(rows) ? {} : {}) }]
                  : [{ id: 1 }],
              then: (resolve: (v: unknown) => void) => Promise.resolve([{ id: 1 }]).then(resolve),
            }),
          };
        },
      };
      const result = await cb(tx);
      H.txBatches.push(H.currentBatch);
      H.order.push('tx:commit');
      return result;
    },
  },
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));

import { createInvoiceFromWonDeal } from '@/lib/billing/deal-invoice';
import { logError } from '@/lib/errors-server';

const CTX = { tenantId: 'tenant-1', userId: 'user-1' };
const DEAL_ROW = { title: 'Big deal', amount: '5000.00', contactId: null, companyId: null };

beforeEach(() => {
  H.order = [];
  H.txTables = [];
  H.txBatches = [];
  H.currentBatch = [];
  H.activityFails = false;
  vi.mocked(logError).mockClear();
});

describe('#3107 deal-won invoice — activity is written after commit, never inside the tx', () => {
  it('creates the invoice and writes the activity only after the transaction commits', async () => {
    const id = await createInvoiceFromWonDeal(CTX, 'deal-1', DEAL_ROW);

    expect(id).toBe('inv-1');
    // #3405: the branded client opens its own transaction per read/write, so
    // several tx:start/tx:commit pairs appear. What #3107 pins is that the
    // activity lands after a commit, never inside the invoice transaction.
    expect(H.order.filter((x) => x === 'activity')).toEqual(['activity']);
    expect(H.order.indexOf('activity')).toBeGreaterThan(H.order.indexOf('tx:commit'));
    expect(H.order.at(-1)).toBe('tx:commit');
  });

  it('the invoice transaction never receives the activities insert at all', async () => {
    await createInvoiceFromWonDeal(CTX, 'deal-1', DEAL_ROW);

    const invoiceBatch = H.txBatches.find((batch) => batch.includes('invoices')) ?? [];
    expect(invoiceBatch).toContain('invoices');
    expect(invoiceBatch).not.toContain('activities');
  });

  it('a failing activity insert no longer rolls the invoice back — the id still returns', async () => {
    H.activityFails = true;
    const id = await createInvoiceFromWonDeal(CTX, 'deal-1', DEAL_ROW);

    expect(id).toBe('inv-1');
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'deal-invoice: activity insert' }),
    );
  });
});
