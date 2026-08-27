/**
 * Regression tests for lib/whatsapp/webhook-processor.ts (audit H-A, H-B).
 *
 * H-B: the status-update loop must scope the whatsapp_messages update by the
 *      owning tenant (resolved from the receiving phone number id), not by the
 *      provider message id alone — otherwise a callback/colliding id could flip
 *      another tenant's message row.
 * H-A: an inbound message whose (tenant, external_id) already exists must be
 *      skipped entirely (no duplicate insert, no messageCount increment).
 *
 * We spy on drizzle-orm's `eq`/`and` to capture the exact predicates used, and
 * stub the db so no real database is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface EqCall { column?: string; value: unknown; }
const eqCalls: EqCall[] = [];

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: unknown, value: unknown) => {
      const c = col as { name?: string };
      eqCalls.push({ column: c?.name, value });
      return actual.eq(col as never, value as never);
    },
  };
});

// Controls what db.query.* returns during a run.
const state: {
  integration: { tenantId: string } | null;
  contact: { id: string } | null;
  conversation: { id: string; contactId: string | null } | null;
  existingMessage: { id: string } | null;
  updateWheres: unknown[];
  inserts: string[];
} = {
  integration: null, contact: null, conversation: null, existingMessage: null,
  updateWheres: [], inserts: [],
};

vi.mock('@/drizzle/db', () => {
  const makeUpdate = () => ({
    set: () => ({
      where: (cond: unknown) => { state.updateWheres.push(cond); return Promise.resolve(); },
    }),
  });
  const tx = {
    query: {
      whatsappConversations: { findFirst: () => Promise.resolve(state.conversation) },
      whatsappMessages: { findFirst: () => Promise.resolve(state.existingMessage) },
    },
    insert: (tbl: unknown) => ({
      values: () => {
        state.inserts.push(String((tbl as { _?: { name?: string } })?._?.name ?? 'insert'));
        return { returning: () => Promise.resolve([{ id: 'new-id', contactId: state.contact?.id ?? null }]) };
      },
    }),
    update: makeUpdate,
  };
  return {
    db: {
      query: {
        integrations: { findFirst: () => Promise.resolve(state.integration) },
        contacts: { findFirst: () => Promise.resolve(state.contact) },
        whatsappConversations: { findFirst: () => Promise.resolve(state.conversation) },
        whatsappMessages: { findFirst: () => Promise.resolve(state.existingMessage) },
      },
      transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      update: makeUpdate,
    },
  };
});

const TENANT = 'tenant-A';

describe('processWhatsAppPayload', () => {
  beforeEach(() => {
    eqCalls.length = 0;
    state.integration = { tenantId: TENANT };
    state.contact = null;
    state.conversation = { id: 'conv-1', contactId: null };
    state.existingMessage = null;
    state.updateWheres = [];
    state.inserts = [];
  });

  it('H-B: scopes the status update by tenant_id (not external_id alone)', async () => {
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'phone-1' },
        statuses: [{ id: 'wamid.STATUS', status: 'read' }],
      } }] }],
    });
    // The status UPDATE must have been filtered on BOTH external_id and tenant_id.
    const cols = eqCalls.map((c) => c.column);
    expect(cols).toContain('external_id');
    const tenantEq = eqCalls.find((c) => c.column === 'tenant_id' && c.value === TENANT);
    expect(tenantEq, 'status update must be tenant-scoped').toBeTruthy();
  });

  it('H-B: skips the status update entirely when no integration owns the number', async () => {
    state.integration = null; // unknown receiving number
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'unknown-phone' },
        statuses: [{ id: 'wamid.X', status: 'read' }],
      } }] }],
    });
    expect(state.updateWheres.length, 'no global status write when integration unresolved').toBe(0);
  });

  it('H-A: skips duplicate inbound message (already stored external_id)', async () => {
    state.existingMessage = { id: 'already-there' };
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'phone-1' },
        messages: [{ id: 'wamid.DUP', from: '15551230000', type: 'text', text: { body: 'hi' } }],
      } }] }],
    });
    // No message insert and no conversation messageCount update should happen.
    expect(state.inserts.length, 'duplicate inbound must not insert').toBe(0);
    expect(state.updateWheres.length, 'duplicate inbound must not bump messageCount').toBe(0);
  });
});
