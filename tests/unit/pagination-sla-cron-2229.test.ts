/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Issue #2229 — two guards:
 *
 * 1. Table-driven tests for the shared pagination clamp helper
 *    (lib/api/query-params.ts: parsePageLimit / parseLimitOffset) plus a
 *    source sweep proving every previously-broken list route now routes its
 *    page/limit/offset math through it, and no route in app/api keeps an
 *    unguarded `Math.min/max(parseInt(...))` pagination line.
 *
 * 2. sla-check cron: bounded (batched) ticket scan, breach lookups scoped to
 *    the batch, and notification ONLY after the breach record/escalation was
 *    actually persisted — a failed insert must never notify (phantom breach).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parsePageLimit, parseLimitOffset } from '@/lib/api/query-params';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// Part 1 — shared clamp helper behavior
// ---------------------------------------------------------------------------

describe('#2229 pagination clamp helper (parseLimitOffset / parsePageLimit)', () => {
  const opts = { defaultLimit: 50, maxLimit: 100 };

  describe('parseLimitOffset', () => {
    it.each([
      ['limit=abc', { limit: 50, offset: 0 }],
      ['limit=', { limit: 50, offset: 0 }],
      ['limit=-5', { limit: 1, offset: 0 }],
      ['limit=0', { limit: 1, offset: 0 }],
      ['limit=99999', { limit: 100, offset: 0 }],
      ['limit=99999999999999999999', { limit: 100, offset: 0 }],
      ['offset=garbage', { limit: 50, offset: 0 }],
      ['offset=-10', { limit: 50, offset: 0 }],
      ['limit=x&offset=x', { limit: 50, offset: 0 }],
      ['limit=25&offset=75', { limit: 25, offset: 75 }],
    ])('%s clamps to defaults/caps', (qs, expected) => {
      expect(parseLimitOffset(new URLSearchParams(qs), opts)).toEqual(expected);
    });

    it('never yields NaN or negative values for any fuzzed input', () => {
      for (const bad of ['x', '1e999', ' ', 'null', 'undefined', '-1', '0x10', 'Infinity', '-Infinity']) {
        for (const key of ['limit', 'offset']) {
          const r = parseLimitOffset(new URLSearchParams(`${key}=${bad}`), opts);
          expect(Number.isFinite(r.limit)).toBe(true);
          expect(Number.isFinite(r.offset)).toBe(true);
          expect(r.limit).toBeGreaterThanOrEqual(1);
          expect(r.limit).toBeLessThanOrEqual(opts.maxLimit);
          expect(r.offset).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('parsePageLimit', () => {
    it.each([
      ['page=abc&limit=x', { page: 1, limit: 50, offset: 0 }],
      ['page=-5&limit=-5', { page: 1, limit: 1, offset: 0 }],
      ['page=0&limit=0', { page: 1, limit: 1, offset: 0 }],
      ['limit=99999', { page: 1, limit: 100, offset: 0 }],
      ['page=99999999999999999999', { page: 99999999999999999999, limit: 50, offset: (99999999999999999999 - 1) * 50 }],
      ['page=3&limit=10', { page: 3, limit: 10, offset: 20 }],
    ])('%s normalizes page/limit/offset', (qs, expected) => {
      expect(parsePageLimit(new URLSearchParams(qs), opts)).toEqual(expected);
    });

    it('keeps offset non-negative and finite for garbage page values', () => {
      for (const bad of ['x', '-5', '0', '', 'NaN']) {
        const r = parsePageLimit(new URLSearchParams(`page=${bad}&limit=20`), opts);
        expect(r.offset).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(r.offset)).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Part 1b — source sweep over app/api
// ---------------------------------------------------------------------------

const FIXED_ROUTES = [
  'app/api/tenant/search/route.ts',
  'app/api/tenant/ai/score/route.ts',
  'app/api/tenant/meetings/route.ts',
  'app/api/tenant/chat/route.ts',
  'app/api/tenant/chat/[sessionId]/messages/route.ts',
  'app/api/tenant/lead-warming/replies/route.ts',
  'app/api/tenant/activities/route.ts',
  'app/api/tenant/calls/route.ts',
  'app/api/tenant/sms/route.ts',
  'app/api/tenant/projects/route.ts',
  'app/api/tenant/products/route.ts',
  'app/api/tenant/forms/route.ts',
  'app/api/tenant/jobs/dead-letter/route.ts',
  'app/api/tenant/follow-ups/route.ts',
  'app/api/tenant/permissions/approvals/route.ts',
  'app/api/tenant/custom-entities/route.ts',
  'app/api/tenant/custom-entities/[id]/rows/route.ts',
  'app/api/tenant/tasks/route.ts',
  'app/api/tenant/kb/articles/route.ts',
  'app/api/tenant/esignature/route.ts',
  'app/api/tenant/notifications/route.ts',
  'app/api/tenant/webhooks/dlq/route.ts',
  'app/api/tenant/webhooks/route.ts',
  'app/api/tenant/webhooks/logs/route.ts',
  'app/api/tenant/plugins/[id]/logs/route.ts',
  'app/api/tenant/audit/route.ts',
  'app/api/tenant/data-explorer/route.ts',
  'app/api/superadmin/data-explorer/route.ts',
  'app/api/superadmin/errors/route.ts',
  'app/api/superadmin/ai-credits/route.ts',
  'app/api/super-admin/tenants/route.ts',
  'app/api/v1/leads/route.ts',
  'app/api/v1/contacts/route.ts',
  'app/api/v1/deals/route.ts',
  'app/api/v1/tasks/route.ts',
];

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkRoutes(p, out);
    else if (entry.name === 'route.ts') out.push(p);
  }
  return out;
}

describe('#2229 route sweep — pagination goes through the shared helper', () => {
  it('every fixed route imports and calls parsePageLimit/parseLimitOffset', () => {
    const missing: string[] = [];
    for (const rel of FIXED_ROUTES) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      if (!src.includes('@/lib/api/query-params') || !/parse(?:PageLimit|LimitOffset)\(/.test(src)) {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no route in app/api keeps an unguarded Math.min/max(parseInt(...)) pagination line', () => {
    const offenders: string[] = [];
    for (const file of walkRoutes(join(process.cwd(), 'app/api'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // NaN propagates through Math.min/Math.max, so a clamp around a bare
        // parseInt still yields NaN → `.limit(NaN)` → 500. Only a trailing
        // `|| <number>` NaN fallback (pre-existing safe style) is acceptable.
        if (/^(?:\s*)(?:const|let) (?:limit|offset|page|pageSize|perPage)\b.*Math\.(?:min|max)\(.*parseInt/.test(line)
          && !/\|\| *[0-9]/.test(line)) {
          offenders.push(`${file.replace(process.cwd() + '/', '')}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('meetings route rejects garbage start/end dates with 400 instead of 500', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/tenant/meetings/route.ts'), 'utf8');
    expect(src).toContain('Invalid "start" date');
    expect(src).toContain('Invalid "end" date');
  });
});

// ---------------------------------------------------------------------------
// Part 2 — sla-check cron (bounded scan + no phantom-breach notifications)
// ---------------------------------------------------------------------------

const mockAcquireLock = vi.fn(async (_key: string, _ttl: number) => ({ acquired: true }));
vi.mock('@/lib/cache', () => ({
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
}));

vi.mock('@/lib/crypto', () => ({
  verifySecret: () => true,
}));

const mockLogError = vi.fn(async (_opts: unknown) => {});
vi.mock('@/lib/errors-server', () => ({
  logError: (opts: unknown) => mockLogError(opts),
}));
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
  return true;
});
vi.mock('@/lib/email/service', () => ({
  sendEmail: (opts: unknown) => mockSendEmail(opts),
}));

let sweptTenants: string[] = [TENANT_A];
let sweepResult: CronTenantSweep = { visited: 1, skipped: [], failed: [] };
const mockSweepTenants = vi.fn(async (_context: string, body: (tenantId: string) => Promise<void>) => {
  for (const tenantId of sweptTenants) {
    await body(tenantId);
  }
  return sweepResult;
});
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (tenantId: string) => Promise<void>) => mockSweepTenants(context, body),
}));

// Mutable DB state — read at call time by the db mock below.
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
let insertShouldFail = false;
let updateShouldFail = false;

type SelectCall = { table: string; limited?: number; ordered: boolean; whereCond: unknown };
const selectCalls: SelectCall[] = [];

vi.mock('@/drizzle/db', () => {
  function tableName(source: unknown): string {
    return String((source as Record<symbol, unknown> | undefined)?.[Symbol.for('drizzle:Name')] ?? '');
  }
  function rowsFor(call: SelectCall): unknown[] {
    switch (call.table) {
      case 'support_tickets':
        return ticketBatches.length > 0 ? (ticketBatches.shift() as unknown[]) : [];
      case 'sla_breaches':
        return breachRows;
      case 'tenant_members':
        return adminRows;
      case 'users':
        return userRows;
      default:
        return [];
    }
  }
  function makeChain(): Record<string, unknown> {
    const call: SelectCall = { table: '', ordered: false, whereCond: undefined };
    selectCalls.push(call);
    const chain: Record<string, unknown> = {};
    chain.from = (source: unknown) => {
      call.table = tableName(source);
      return chain;
    };
    chain.where = (cond: unknown) => {
      call.whereCond = cond;
      return chain;
    };
    chain.orderBy = () => {
      call.ordered = true;
      return chain;
    };
    chain.limit = (n: unknown) => {
      call.limited = Number(n);
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(call)).then(resolve, reject);
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => ({
        values: () =>
          insertShouldFail
            ? Promise.reject(new Error('forced breach-insert failure'))
            : Promise.resolve(events.push('insert-recorded')),
      }),
      update: () => ({
        set: () => ({
          where: () =>
            updateShouldFail
              ? Promise.reject(new Error('forced escalation-update failure'))
              : Promise.resolve(events.push('escalation-recorded')),
        }),
      }),
      query: {
        slaPolicies: {
          findMany: async () => policyRows,
        },
      },
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
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6h ago -> medium response SLA (4h) breached
    firstResponseAt: null,
    resolvedAt: null,
    status: 'open',
    ...overrides,
  };
}

/** Column names + primitive values referenced inside a Drizzle condition. */
function conditionBits(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 14 || node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const n of node) conditionBits(n, out, depth + 1);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec['name'] === 'string' && typeof rec['columnType'] === 'string') out.push(`col:${rec['name']}`);
  if (typeof rec['value'] === 'string' || typeof rec['value'] === 'number') out.push(`val:${String(rec['value'])}`);
  if (Array.isArray(rec['queryChunks'])) conditionBits(rec['queryChunks'], out, depth + 1);
  return out;
}

async function runCron() {
  const { POST } = await import('@/app/api/cron/sla-check/route');
  const req = { headers: new Headers({ 'x-cron-secret': 's' }) } as never;
  const res = await POST(req);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('POST /api/cron/sla-check (#2229 bounded scan + recorded-only notifications)', () => {
  beforeEach(() => {
    selectCalls.length = 0;
    events.length = 0;
    ticketBatches = [[makeTicket()]];
    breachRows = [];
    policyRows = [];
    userRows = [{ email: 'rep@example.com', fullName: 'Rep One' }];
    adminRows = [{ userId: 'admin-1' }];
    insertShouldFail = false;
    updateShouldFail = false;
    sweptTenants = [TENANT_A];
    sweepResult = { visited: 1, skipped: [], failed: [] };
    mockAcquireLock.mockReset();
    mockAcquireLock.mockResolvedValue({ acquired: true });
    mockSweepTenants.mockClear();
    mockCreateNotification.mockClear();
    mockSendEmail.mockClear();
    mockLogError.mockClear();
  });

  it('scans tickets in bounded batches (explicit LIMIT + deterministic ORDER BY)', async () => {
    const res = await runCron();
    expect(res.status).toBe(200);

    const ticketQuery = selectCalls.find((c) => c.table === 'support_tickets');
    expect(ticketQuery).toBeDefined();
    expect(ticketQuery!.limited).toBe(200); // never an unbounded fetch
    expect(ticketQuery!.ordered).toBe(true); // stable batch key for pagination
    expect(res.body.tickets_checked).toBe(1);
  });

  it('scopes the breach-history lookup to the batch via entity_id IN (...) instead of a full-table fetch', async () => {
    await runCron();
    const breachQuery = selectCalls.find((c) => c.table === 'sla_breaches');
    expect(breachQuery).toBeDefined();
    const bits = conditionBits(breachQuery!.whereCond);
    expect(bits).toContain('col:entity_id');
    expect(bits).toContain('val:ticket-1'); // batch ids pushed into the IN list
    expect(breachQuery!.limited).toBeUndefined();
  });

  it('records the breach BEFORE notifying when the insert succeeds', async () => {
    const res = await runCron();
    expect(res.body.new_breaches).toBe(1);
    expect(res.body.notified).toBe(1);
    expect(res.body.unrecorded_breaches).toBe(0);
    expect(events).toEqual(['insert-recorded', 'notify:sla_breach:user-1']);
  });

  it('does NOT notify when the breach insert fails (no phantom breaches)', async () => {
    insertShouldFail = true;
    const res = await runCron();
    expect(res.status).toBe(200);
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(res.body.new_breaches).toBe(0);
    expect(res.body.notified).toBe(0);
    expect(res.body.unrecorded_breaches).toBe(1);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'cron/sla-check:breach-insert' }),
    );
  });

  it('does not re-insert or re-notify an already-recorded, un-escalated breach (dedupe)', async () => {
    breachRows = [{
      id: 'breach-1',
      tenantId: TENANT_A,
      entityType: 'ticket',
      entityId: 'ticket-1',
      breachType: 'response',
      escalationLevel: 0,
      resolvedAt: null,
    }];
    const res = await runCron();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(res.body.new_breaches).toBe(0);
    expect(res.body.escalations).toBe(0);
    expect(res.body.notified).toBe(0);
  });

  it('escalates only after the update is persisted, then notifies admins', async () => {
    // Policy whose rules push this breach to escalation level 2; the recorded
    // breach sits at level 1, so a transition happens.
    policyRows = [{
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
    }];
    breachRows = [{
      id: 'breach-1',
      tenantId: TENANT_A,
      entityType: 'ticket',
      entityId: 'ticket-1',
      breachType: 'response',
      escalationLevel: 1,
      resolvedAt: null,
    }];
    const res = await runCron();
    expect(res.body.escalations).toBe(1);
    expect(events).toEqual(['escalation-recorded', 'notify:sla_escalation:admin-1']);
  });

  it('does NOT send escalation notifications when the escalation update fails', async () => {
    policyRows = [{
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
    }];
    breachRows = [{
      id: 'breach-1',
      tenantId: TENANT_A,
      entityType: 'ticket',
      entityId: 'ticket-1',
      breachType: 'response',
      escalationLevel: 1,
      resolvedAt: null,
    }];
    updateShouldFail = true;
    const res = await runCron();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(res.body.escalations).toBe(0);
    expect(res.body.notified).toBe(0);
    expect(res.body.unrecorded_breaches).toBe(1);
  });

  it('continues to the next batch when a full batch is returned, then stops on a short one', async () => {
    const batch1: TicketRow[] = Array.from({ length: 200 }, (_, i) =>
      makeTicket({ id: `t-${i}`, createdAt: new Date(Date.now() - 480 * 60 * 1000) }),
    );
    ticketBatches = [batch1, [makeTicket({ id: 'tail-ticket' })]];
    const res = await runCron();
    expect(res.body.tickets_checked).toBe(201);
    const ticketQueries = selectCalls.filter((c) => c.table === 'support_tickets');
    expect(ticketQueries.length).toBe(2); // bounded: two capped fetches, not one unbounded fetch
    expect(ticketQueries.every((c) => c.limited === 200)).toBe(true);
  });
});
