import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableColumns } from 'drizzle-orm';

import { notifications } from '@/drizzle/schema';

/**
 * Deep-link derivation for notifications (#regression: SLA / contract /
 * subscription notifications used to be labelled entity_type 'contact' and so
 * deep-linked to /tenant/contacts/<ticket-id>, a guaranteed 404).
 *
 * Mocking follows tests/unit/record-links.test.ts: the db layer is faked at the
 * boundary and the payload handed to Drizzle is captured verbatim, so the
 * assertions are about what would actually be written rather than about which
 * internal helper happened to run. `@/drizzle/schema` is deliberately NOT
 * mocked — the real `notifications` table is needed to check the insert payload
 * against the genuine column list.
 */

/** The table object createNotification passed to `insert()`. */
let lastInsertTable: unknown = null;
/** The values object createNotification passed to `.values()`. */
let lastInsertValues: Record<string, unknown> | null = null;
/** Every `.values()` payload seen, in call order (retry path visibility). */
let allInsertValues: Record<string, unknown>[] = [];
/** Rows returned for the tenantMembers lookup in notifyTenantMembers. */
let memberRows: { userId: string }[] = [];

const insertSpy = vi.fn((table: unknown) => {
  lastInsertTable = table;
  return {
    values: vi.fn(async (v: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(v) ? v : [v];
      for (const row of rows) allInsertValues.push(row);
      lastInsertValues = rows[0] ?? null;
      return undefined;
    }),
  };
});

vi.mock('@/lib/db/rls', () => ({
  withTenantContext: vi.fn(
    async (_tenantId: string, _userId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: insertSpy }),
  ),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => memberRows) })),
    })),
  },
}));

// Realtime push is best-effort and pulls ioredis in; stub it out.
vi.mock('@/lib/realtime/publish', () => ({
  publishNewNotification: vi.fn(async () => undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const ENTITY = '33333333-3333-3333-3333-333333333333';

/**
 * Expected link for every member of the entity-type union.
 *
 * `task` and `sequence` have no per-record page, so they resolve to their list
 * route. The `union coverage` test below asserts this table matches
 * NOTIFICATION_ENTITY_TYPES exactly, which is what makes a newly added union
 * member without a link mapping fail loudly instead of passing silently.
 */
const EXPECTED_LINKS: Record<string, string> = {
  contact:      `/tenant/contacts/${ENTITY}`,
  deal:         `/tenant/deals/${ENTITY}`,
  task:         `/tenant/tasks`,
  company:      `/tenant/companies/${ENTITY}`,
  lead:         `/tenant/leads/${ENTITY}`,
  sequence:     `/tenant/sequences`,
  ticket:       `/tenant/tickets/${ENTITY}`,
  contract:     `/tenant/contracts/${ENTITY}`,
  subscription: `/tenant/subscriptions/${ENTITY}`,
};

/** Fire createNotification and hand back the single captured insert payload. */
async function notifyWith(
  overrides: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { createNotification } = await import('@/lib/notifications');
  await createNotification({
    userId: USER,
    tenantId: TENANT,
    type: 'system',
    title: 'Something happened',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  expect(lastInsertValues).not.toBeNull();
  return lastInsertValues as Record<string, unknown>;
}

describe('notification deep links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastInsertTable = null;
    lastInsertValues = null;
    allInsertValues = [];
    memberRows = [{ userId: USER }];
  });

  describe('every entity type in the union resolves to a real page route', () => {
    it('the expected-link table covers the declared union exactly', async () => {
      const { NOTIFICATION_ENTITY_TYPES } = await import('@/lib/notifications');
      expect([...NOTIFICATION_ENTITY_TYPES].sort()).toEqual(Object.keys(EXPECTED_LINKS).sort());
    });

    for (const [entityType, expectedLink] of Object.entries(EXPECTED_LINKS)) {
      it(`derives ${expectedLink} for entity_type '${entityType}'`, async () => {
        const values = await notifyWith({ entity_type: entityType, entity_id: ENTITY });
        expect(values['link']).toBe(expectedLink);
      });
    }
  });

  describe('the mislabelled-entity regression', () => {
    it("'ticket' deep-links to the ticket page, never the contact page", async () => {
      const values = await notifyWith({
        type: 'sla_breach',
        entity_type: 'ticket',
        entity_id: ENTITY,
      });
      expect(values['link']).toBe(`/tenant/tickets/${ENTITY}`);
      expect(values['link']).not.toBe(`/tenant/contacts/${ENTITY}`);
      expect(values['link']).not.toContain('/tenant/contacts/');
    });

    it("'contract' deep-links to the contract page, not the contact page", async () => {
      const values = await notifyWith({
        type: 'contract_renewal',
        entity_type: 'contract',
        entity_id: ENTITY,
      });
      expect(values['link']).toBe(`/tenant/contracts/${ENTITY}`);
      expect(values['link']).not.toContain('/tenant/contacts/');
    });

    it("'subscription' deep-links to the subscription page, not the contact page", async () => {
      const values = await notifyWith({
        type: 'subscription_renewal',
        entity_type: 'subscription',
        entity_id: ENTITY,
      });
      expect(values['link']).toBe(`/tenant/subscriptions/${ENTITY}`);
      expect(values['link']).not.toContain('/tenant/contacts/');
    });

    it("'sequence' links to the list route and never embeds the entity id", async () => {
      // There is no app/tenant/sequences/[id]/page.tsx, so an id-bearing link
      // would 404 exactly the way the ticket links did.
      const values = await notifyWith({ entity_type: 'sequence', entity_id: ENTITY });
      expect(values['link']).toBe('/tenant/sequences');
      expect(values['link']).not.toContain(ENTITY);
    });

    it('notifyTenantMembers derives the same ticket route as createNotification', async () => {
      const { notifyTenantMembers } = await import('@/lib/notifications');
      await notifyTenantMembers({
        tenantId: TENANT,
        type: 'sla_escalation',
        title: 'SLA escalation',
        entity_type: 'ticket',
        entity_id: ENTITY,
      });
      expect(lastInsertValues?.['link']).toBe(`/tenant/tickets/${ENTITY}`);
    });
  });

  describe('link precedence and absence', () => {
    it('an explicitly supplied link wins over the derived one', async () => {
      const values = await notifyWith({
        link: '/tenant/somewhere/custom',
        entity_type: 'contact',
        entity_id: ENTITY,
      });
      expect(values['link']).toBe('/tenant/somewhere/custom');
    });

    it('an explicit link wins even when it disagrees with a ticket entity', async () => {
      const values = await notifyWith({
        link: `/tenant/tickets/${ENTITY}?tab=sla`,
        entity_type: 'ticket',
        entity_id: ENTITY,
      });
      expect(values['link']).toBe(`/tenant/tickets/${ENTITY}?tab=sla`);
    });

    it('no entity reference at all means no derived link, and the insert still succeeds', async () => {
      const values = await notifyWith({});
      expect(values['link']).toBeNull();
      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(allInsertValues).toHaveLength(1);
    });

    it('an entity_type with no entity_id derives no link', async () => {
      const values = await notifyWith({ entity_type: 'task' });
      expect(values['link']).toBeNull();
    });

    it('an unknown entity_type derives no link rather than a bogus one', async () => {
      const values = await notifyWith({ entity_type: 'wormhole', entity_id: ENTITY });
      expect(values['link']).toBeNull();
    });
  });

  describe('persisted payload', () => {
    it('records entity_type and entity_id in metadata', async () => {
      const values = await notifyWith({ entity_type: 'ticket', entity_id: ENTITY });
      expect(values['metadata']).toMatchObject({
        entity_type: 'ticket',
        entity_id: ENTITY,
      });
    });

    it('preserves caller-supplied metadata alongside the injected entity reference', async () => {
      const values = await notifyWith({
        entity_type: 'contract',
        entity_id: ENTITY,
        metadata: { reminder_days: 30, contract_id: ENTITY },
      });
      expect(values['metadata']).toMatchObject({
        reminder_days: 30,
        contract_id: ENTITY,
        entity_type: 'contract',
        entity_id: ENTITY,
      });
    });

    it('writes the notification type to the type column', async () => {
      const values = await notifyWith({ type: 'sla_breach' });
      expect(values['type']).toBe('sla_breach');
    });

    it('inserts into the notifications table', async () => {
      await notifyWith({ entity_type: 'ticket', entity_id: ENTITY });
      expect(lastInsertTable).toBe(notifications);
    });

    it('every key in the insert payload is a real notifications column', async () => {
      const values = await notifyWith({
        entity_type: 'subscription',
        entity_id: ENTITY,
        body: 'Renews soon',
        metadata: { subscription_id: ENTITY },
      });
      const realColumns = Object.keys(getTableColumns(notifications));
      expect(realColumns).toContain('link');
      expect(realColumns).toContain('metadata');
      const ghostKeys = Object.keys(values).filter((k) => !realColumns.includes(k));
      expect(ghostKeys).toEqual([]);
    });
  });
});
