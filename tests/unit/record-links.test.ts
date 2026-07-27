import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Results for the successive EXISTS checks that assertRecordInTenant performs,
 * consumed in call order (the `from` endpoint is checked first, then `to`).
 * Driving this by a queue rather than by parsing Drizzle's internal SQL chunks
 * keeps the test independent of ORM internals.
 */
let existsQueue: boolean[] = [];
let lastInsertValues: Record<string, unknown> | null = null;
let insertReturns: Record<string, unknown>[] = [];
let updateReturns: Record<string, unknown>[] = [];
let selectRows: Record<string, unknown>[] = [];

vi.mock('@/drizzle/db', () => {
  const db = {
    // assertRecordInTenant() issues one raw EXISTS query per endpoint.
    execute: vi.fn(async () => {
      const exists = existsQueue.length ? existsQueue.shift() : true;
      return { rows: [{ exists }] };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        lastInsertValues = v;
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => insertReturns),
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => updateReturns) })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => selectRows) })),
    })),
    query: {
      recordLinks: { findFirst: vi.fn(async () => selectRows[0] ?? null) },
    },
  };
  return { db };
});

const TENANT = '11111111-1111-1111-1111-111111111111';
const TICKET = '22222222-2222-2222-2222-222222222222';
const DEAL = '33333333-3333-3333-3333-333333333333';

describe('record links service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsQueue = []; // default: every endpoint resolves as present
    lastInsertValues = null;
    insertReturns = [{ id: 'link-1', relation: 'related' }];
    updateReturns = [{ id: 'link-1' }];
    selectRows = [];
  });

  describe('input validation', () => {
    it('rejects an unknown entity type', async () => {
      const { linkRecords, RecordLinkError } = await import('@/lib/record-links');
      await expect(
        linkRecords({ tenantId: TENANT, fromType: 'wormhole', fromId: TICKET, toType: 'deal', toId: DEAL })
      ).rejects.toThrow(RecordLinkError);
    });

    it('rejects an unknown relation', async () => {
      const { linkRecords } = await import('@/lib/record-links');
      await expect(
        linkRecords({
          tenantId: TENANT, fromType: 'ticket', fromId: TICKET,
          toType: 'deal', toId: DEAL, relation: 'vibes',
        })
      ).rejects.toThrow(/relation/i);
    });

    // Guarded in the service as well as by a CHECK constraint, so the error is a
    // clear 400 rather than a database exception.
    it('rejects linking a record to itself', async () => {
      const { linkRecords } = await import('@/lib/record-links');
      await expect(
        linkRecords({ tenantId: TENANT, fromType: 'deal', fromId: DEAL, toType: 'deal', toId: DEAL })
      ).rejects.toThrow(/itself/i);
    });
  });

  describe('tenant safety', () => {
    // This is the whole reason the service exists. The endpoints are polymorphic
    // so PostgreSQL cannot foreign-key them, which means nothing at the database
    // level stops a link pointing into another tenant.
    it('refuses to link a record that is not in this tenant', async () => {
      existsQueue = [true, false]; // ticket is ours, deal belongs to someone else
      const { linkRecords } = await import('@/lib/record-links');

      await expect(
        linkRecords({ tenantId: TENANT, fromType: 'ticket', fromId: TICKET, toType: 'deal', toId: DEAL })
      ).rejects.toThrow(/no deal/i);
    });

    it('does not write anything when validation fails', async () => {
      existsQueue = [false, false];
      const { db } = await import('@/drizzle/db');
      const { linkRecords } = await import('@/lib/record-links');

      await expect(
        linkRecords({ tenantId: TENANT, fromType: 'ticket', fromId: TICKET, toType: 'deal', toId: DEAL })
      ).rejects.toThrow();

      expect(db.insert).not.toHaveBeenCalled();
    });

    // The message must not reveal whether the id exists under another tenant.
    it('does not distinguish "missing" from "another tenant\'s"', async () => {
      existsQueue = [true, false];
      const { linkRecords } = await import('@/lib/record-links');

      const err = await linkRecords({
        tenantId: TENANT, fromType: 'ticket', fromId: TICKET, toType: 'deal', toId: DEAL,
      }).catch((e: Error) => e);

      expect(err.message).not.toMatch(/other|another|forbidden|exists/i);
    });

    it('stamps the link with the caller tenant', async () => {
      const { linkRecords } = await import('@/lib/record-links');
      await linkRecords({
        tenantId: TENANT, fromType: 'ticket', fromId: TICKET, toType: 'deal', toId: DEAL,
      });
      expect(lastInsertValues).toMatchObject({ tenantId: TENANT });
    });
  });

  describe('linking', () => {
    it('defaults the relation to "related"', async () => {
      const { linkRecords } = await import('@/lib/record-links');
      await linkRecords({
        tenantId: TENANT, fromType: 'ticket', fromId: TICKET, toType: 'deal', toId: DEAL,
      });
      expect(lastInsertValues).toMatchObject({ relation: 'related' });
    });

    // A double-submit must not produce two identical links.
    it('returns the existing link when one is already present', async () => {
      insertReturns = [];
      selectRows = [{ id: 'existing-link', relation: 'related' }];

      const { linkRecords } = await import('@/lib/record-links');
      const row = await linkRecords({
        tenantId: TENANT, fromType: 'ticket', fromId: TICKET, toType: 'deal', toId: DEAL,
      });

      expect(row).toMatchObject({ id: 'existing-link' });
    });
  });

  describe('getLinkedRecords', () => {
    // Links are undirected for display: a ticket linked to a deal must show up on
    // the deal too, regardless of which side created it.
    it('returns the far end whichever direction the link was stored', async () => {
      selectRows = [
        { id: 'l1', fromType: 'ticket', fromId: TICKET, toType: 'deal', toId: DEAL, relation: 'related', note: null, createdAt: new Date() },
        { id: 'l2', fromType: 'deal', fromId: DEAL, toType: 'ticket', toId: TICKET, relation: 'blocks', note: null, createdAt: new Date() },
      ];

      const { getLinkedRecords } = await import('@/lib/record-links');
      const links = await getLinkedRecords(TENANT, 'ticket', TICKET);

      expect(links).toHaveLength(2);
      // Both rows involve the same ticket, so both must resolve to the deal.
      expect(links.map((l) => l.entityType)).toEqual(['deal', 'deal']);
      expect(links.map((l) => l.entityId)).toEqual([DEAL, DEAL]);
      expect(links.map((l) => l.relation)).toEqual(['related', 'blocks']);
    });

    it('rejects an unknown entity type', async () => {
      const { getLinkedRecords } = await import('@/lib/record-links');
      await expect(getLinkedRecords(TENANT, 'wormhole', DEAL)).rejects.toThrow(/unsupported/i);
    });
  });

  describe('unlinkRecords', () => {
    it('reports success when a row was soft-deleted', async () => {
      const { unlinkRecords } = await import('@/lib/record-links');
      await expect(unlinkRecords(TENANT, 'link-1')).resolves.toBe(true);
    });

    it('reports failure when nothing matched in this tenant', async () => {
      updateReturns = [];
      const { unlinkRecords } = await import('@/lib/record-links');
      await expect(unlinkRecords(TENANT, 'link-1')).resolves.toBe(false);
    });
  });
});
