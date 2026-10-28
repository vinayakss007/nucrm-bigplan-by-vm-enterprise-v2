/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Issue #3315 ask 2 — sla-check's recipient reads.
 *
 * Two reads decide who hears about a breach, and both were invisible when they
 * came back empty:
 *
 * 1. `sendEscalationNotification` selects the tenant's active owner/admin
 *    members and loops over the result. An empty result sent nothing, yet the
 *    caller still bumped `notified` and the route still returned `{ok: true}`.
 *    The admin read is guarded by tenant_isolation with no super-admin branch,
 *    so this is exactly the "green run that covered nobody" the sweep module was
 *    written to prevent — one level further down.
 * 2. `sendBreachNotification`'s level-2+ email leg reads the assignee's row and
 *    tests `user?.email`. That one expression conflates two different things: a
 *    user ROW that is absent (the ticket points at someone who is not in `users`
 *    — a broken reference that will never resolve itself) and a user with no
 *    email address (a configuration gap; the in-app notification still reached
 *    them). Only the first is worth an operator's attention.
 *
 * The bounded-scan and phantom-breach guarantees for this route live in
 * tests/unit/pagination-sla-cron-2229.test.ts; this spec owns the reporting of
 * the recipient reads only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/auth/cron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/cron')>()),
  verifyCronSecret: vi.fn(async () => true),
}));
vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true })),
  releaseLock: vi.fn(async () => {}),
}));
const mockLogError = vi.fn(async () => {});
vi.mock('@/lib/errors-server', () => ({ logError: (opts: unknown) => mockLogError(opts) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn(() => NextResponse.json({ error: 'Internal error' }, { status: 500 })),
}));

const events: string[] = [];
const mockCreateNotification = vi.fn(async (opts: { type?: string; userId?: string }) => {
  events.push(`notify:${opts.type}:${opts.userId}`);
  return true;
});
vi.mock('@/lib/notifications', () => ({
  createNotification: (opts: { type?: string; userId?: string }) => mockCreateNotification(opts),
}));
const mockSendEmail = vi.fn(async (_opts: unknown) => {
  events.push('email');
  return { success: true, provider: 'resend', id: 'msg-1' };
});
vi.mock('@/lib/email/service', () => ({ sendEmail: (opts: unknown) => mockSendEmail(opts) }));

let sweptTenants: string[] = [TENANT_A];
let sweepResult: CronTenantSweep = { visited: 1, skipped: [], failed: [] };
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: async (_context: string, body: (tenantId: string) => Promise<void>) => {
    for (const tenantId of sweptTenants) await body(tenantId);
    return sweepResult;
  },
}));

type TicketRow = {
  id: string; tenantId: string; subject: string; priority: string;
  assignedTo: string | null; createdAt: Date; firstResponseAt: Date | null;
  resolvedAt: Date | null; status: string;
};
let ticketBatches: TicketRow[][] = [];
let breachRows: Array<Record<string, unknown>> = [];
let policyRows: Array<Record<string, unknown>> = [];
let userRows: Array<Record<string, unknown>> = [];
let adminRows: Array<Record<string, unknown>> = [];

vi.mock('@/drizzle/db', () => {
  function tableName(source: unknown): string {
    return String((source as Record<symbol, unknown> | undefined)?.[Symbol.for('drizzle:Name')] ?? '');
  }
  function rowsFor(table: string): unknown[] {
    switch (table) {
      case 'support_tickets': return ticketBatches.length > 0 ? (ticketBatches.shift() as unknown[]) : [];
      case 'sla_breaches': return breachRows;
      case 'tenant_members': return adminRows;
      case 'users': return userRows;
      default: return [];
    }
  }
  return {
    db: {
      select: () => {
        const seen: { table: string } = { table: '' };
        const chain: Record<string, unknown> = {};
        chain.from = (source: unknown) => { seen.table = tableName(source); return chain; };
        chain.where = () => chain;
        chain.orderBy = () => chain;
        chain.limit = () => chain;
        chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rowsFor(seen.table)).then(resolve, reject);
        return chain;
      },
      insert: () => ({ values: () => Promise.resolve(events.push('insert-recorded')) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(events.push('escalation-recorded')) }) }),
      query: { slaPolicies: { findMany: async () => policyRows } },
    },
  };
});

function makeTicket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 'ticket-1',
    tenantId: TENANT_A,
    subject: 'Printer on fire',
    priority: 'medium',
    assignedTo: 'user-1',
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
    firstResponseAt: null,
    resolvedAt: null,
    status: 'open',
    ...overrides,
  };
}

/** Rules that put an overdue medium ticket at escalation level 2. */
const LEVEL2_POLICY = {
  tenantId: TENANT_A,
  priority: 'medium',
  name: 'medium-policy',
  isActive: true,
  responseTimeMinutes: 240,
  resolutionTimeMinutes: 480,
  escalationRules: [
    { level: 1, afterMinutes: 240, notifyUserIds: [], action: 'notify' },
    { level: 2, afterMinutes: 241, notifyUserIds: [], action: 'escalate' },
  ],
};

async function runCron() {
  const { POST } = await import('@/app/api/cron/sla-check/route');
  const res = await POST({ headers: new Headers({ 'x-cron-secret': 's' }) } as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('POST /api/cron/sla-check recipient reads (#3315)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    ticketBatches = [[makeTicket()]];
    breachRows = [];
    policyRows = [];
    userRows = [{ email: 'rep@example.com', fullName: 'Rep One' }];
    adminRows = [{ userId: 'admin-1' }];
    sweptTenants = [TENANT_A];
    sweepResult = { visited: 1, skipped: [], failed: [] };
  });

  it('counts a breach that reached a recipient and reports the new counters at zero', async () => {
    const res = await runCron();

    expect(res.body).toMatchObject({
      ok: true,
      new_breaches: 1,
      notified: 1,
      breaches_without_recipient: 0,
      escalations_without_recipient: 0,
      assignee_rows_missing: 0,
    });
  });

  it('reports an escalation whose admin member read came back empty instead of notifying nobody silently', async () => {
    // The ticket already has a recorded breach at level 1, so the policy's level
    // 2 is a transition and the escalation notification path runs.
    policyRows = [LEVEL2_POLICY];
    breachRows = [{
      id: 'breach-1',
      tenantId: TENANT_A,
      entityType: 'ticket',
      entityId: 'ticket-1',
      breachType: 'response',
      escalationLevel: 1,
      resolvedAt: null,
    }];
    adminRows = [];

    const res = await runCron();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      escalations: 1,
      notified: 0,
      escalations_without_recipient: 1,
    });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.stringContaining('escalation-recipients') }),
    );
  });

  it('reports a level-2 email leg whose assignee row is missing from users', async () => {
    policyRows = [LEVEL2_POLICY];
    userRows = [];

    const res = await runCron();

    expect(res.body).toMatchObject({
      ok: false,
      new_breaches: 1,
      // The in-app notification still went out, so the ticket was not ignored.
      notified: 1,
      assignee_rows_missing: 1,
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.stringContaining('assignee-row-missing') }),
    );
  });

  it('treats an assignee with no email as a configuration gap, not a missing row', async () => {
    policyRows = [LEVEL2_POLICY];
    userRows = [{ email: null, fullName: 'Rep One' }];

    const res = await runCron();

    expect(res.body).toMatchObject({ ok: true, notified: 1, assignee_rows_missing: 0 });
    const logged = mockLogError.mock.calls.map((c) => String((c[0] as { context?: string }).context ?? ''));
    expect(logged.filter((c) => c.includes('assignee-row-missing'))).toHaveLength(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('a breach on an unassigned ticket is counted, not reported as notified', async () => {
    ticketBatches = [[makeTicket({ assignedTo: null })]];

    const res = await runCron();

    expect(res.body).toMatchObject({ new_breaches: 1, notified: 0, breaches_without_recipient: 1 });
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
